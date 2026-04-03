import { query, queryOne } from '../db/client';
import { cacheGet, cacheSet } from '../db/redis';
import { buildAuthContext } from '../middleware/auth';
import { dbPut, dbQueryAll, TABLES } from '../db/dynamo';
import { REDIS_TTL } from '../../shared/constants';
import { ok } from '../../shared/response';
import { Errors } from '../../shared/errors';
import { createLogger, toResponse } from '../../shared/logger';
import type { ApiEvent, ApiResponse, OneLiner } from '../../shared/types';

const log = createLogger('oneliner');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const extractUUID = (params: Record<string, string> | undefined, key: string): string => {
  const value = params?.[key];
  if (!value || typeof value !== 'string') throw Errors.badRequest(`Missing path parameter: ${key}`);
  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) {
    throw Errors.badRequest(`Invalid ${key} format`);
  }
  return trimmed;
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/one-liners/subjects/:subjectId
// Returns all one liners for a subject, merged with user's seen progress.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   subjectId validated as strict UUID ✅
// - [AUTHZ] Subject's courseId verified against user's enrolled sub-course ✅
// - [CACHE] One liners content cached per subject — same for all users, safe to share ✅
// - [DATA]  User progress fetched from DynamoDB — real-time, not cached ✅
// - [DATA]  Returns only active one liners — inactive invisible to users ✅
// - [MERGE] seenMap built from DynamoDB progress, merged O(n) — no quadratic scan ✅
// ─────────────────────────────────────────────────────────────

export const getOneLinersBySubject = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth      = await buildAuthContext(event);
    const subjectId = extractUUID(event.pathParameters, 'subjectId');

    // Verify subject exists and get its courseId for access control
    const subject = await queryOne<{ courseId: string }>(
      `SELECT course_id AS "courseId"
       FROM subjects
       WHERE subject_id = $1 AND is_active = TRUE`,
      [subjectId],
    );

    if (!subject) throw Errors.notFound('Subject');

    // Enforce course access for profile-completed users
    const user = await queryOne<{ subCourse: string | null; profileCompleted: boolean }>(
      `SELECT sub_course AS "subCourse", profile_completed AS "profileCompleted"
       FROM users WHERE user_id = $1 AND deleted_at IS NULL AND is_banned = FALSE`,
      [auth.userId],
    );

    if (user?.profileCompleted && user.subCourse && subject.courseId !== user.subCourse) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    // Cache one liners content — same for all users, safe to share
    const cacheKey = `one-liners:subject:${subjectId}`;
    let oneLiners  = await cacheGet<OneLiner[]>(cacheKey);

    if (!oneLiners) {
      oneLiners = await query<OneLiner>(
        `SELECT
           one_liner_id AS "oneLinerId",
           subject_id   AS "subjectId",
           chapter_id   AS "chapterId",
           question,
           answer
         FROM one_liners
         WHERE subject_id = $1 AND is_active = TRUE
         ORDER BY created_at ASC`,
        [subjectId],
      );

      await cacheSet(cacheKey, oneLiners, REDIS_TTL.SUBJECTS);
    }

    if (oneLiners.length === 0) return ok({ subjectId, oneLiners: [], total: 0, seenCount: 0 });

    // Fetch user's seen progress from DynamoDB — real-time, paginated fully
    // dbQueryAll used — single-page dbQuery risks silently truncating at 1MB
    const progressRows = await dbQueryAll<{ userId: string; oneLinerId: string; seenAt: string }>(
      {
        TableName:                 TABLES.ONE_LINER_PROGRESS,
        KeyConditionExpression:    'userId = :uid',
        ExpressionAttributeValues: { ':uid': auth.userId },
      },
    );

    // Build O(1) lookup — avoids quadratic scan when merging large lists
    const seenMap = new Set(progressRows.map(p => p.oneLinerId));

    const result = oneLiners.map(ol => ({
      ...ol,
      seen: seenMap.has(ol.oneLinerId),
    }));

    return ok({ subjectId, oneLiners: result, total: result.length, seenCount: seenMap.size });
  } catch (err) {
    return toResponse(err, { handler: 'getOneLinersBySubject' });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/core/one-liners/:oneLinerId/seen
// Marks a one liner as seen (user tapped "Show Answer").
// Idempotent — repeat calls do not error and do not double-write.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   oneLinerId validated as strict UUID ✅
// - [AUTHZ] One liner verified against Aurora — must exist and belong to user's course ✅
// - [IDOR]  userId always from JWT — user cannot mark another user's progress ✅
// - [IDEM]  Unconditional PutItem — DynamoDB overwrites same key, no duplicates possible ✅
// - [DATA]  seenAt server-set (ISO 8601) — client cannot forge timestamps ✅
// ─────────────────────────────────────────────────────────────

export const markOneLinerSeen = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth       = await buildAuthContext(event);
    const oneLinerId = extractUUID(event.pathParameters, 'oneLinerId');

    // Verify one liner exists and join to get courseId for access control
    const oneLiner = await queryOne<{ subjectId: string; courseId: string }>(
      `SELECT
         ol.subject_id AS "subjectId",
         s.course_id   AS "courseId"
       FROM one_liners ol
       JOIN subjects s ON s.subject_id = ol.subject_id
       WHERE ol.one_liner_id = $1 AND ol.is_active = TRUE`,
      [oneLinerId],
    );

    if (!oneLiner) throw Errors.notFound('One liner');

    // Enforce course access for profile-completed users
    const user = await queryOne<{ subCourse: string | null; profileCompleted: boolean }>(
      `SELECT sub_course AS "subCourse", profile_completed AS "profileCompleted"
       FROM users WHERE user_id = $1 AND deleted_at IS NULL AND is_banned = FALSE`,
      [auth.userId],
    );

    if (user?.profileCompleted && user.subCourse && oneLiner.courseId !== user.subCourse) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    // Always write — PutItem overwrites with same data on repeat calls (idempotent).
    // A pre-check dbGet would save one write unit but costs a read unit on every call.
    // Since repeat taps are uncommon and write cost == read cost on DynamoDB on-demand,
    // the unconditional write is simpler and avoids a read-then-write race condition.
    await dbPut(TABLES.ONE_LINER_PROGRESS, {
      userId:    auth.userId,
      oneLinerId,
      seenAt:    new Date().toISOString(),
    });

    log.info('one liner seen', { userId: auth.userId, oneLinerId });

    return ok({ oneLinerId, seen: true });
  } catch (err) {
    return toResponse(err, { handler: 'markOneLinerSeen' });
  }
};
