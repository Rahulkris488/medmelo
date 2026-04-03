import { query, queryOne } from '../db/client';
import { cacheGet, cacheSet, cacheGet as redisGet } from '../db/redis';
import { buildAuthContext, extractClaims, getAuthUser } from '../middleware/auth';
import { REDIS_KEYS, REDIS_TTL } from '../../shared/constants';
import { ok } from '../../shared/response';
import { Errors } from '../../shared/errors';
import { createLogger, toResponse } from '../../shared/logger';
import type { ApiEvent, ApiResponse, Course, Subject, Chapter } from '../../shared/types';
import Redis from 'ioredis';

const log = createLogger('course');

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// Validates path parameters — rejects empty, oversized, traversal, special chars
const extractParam = (params: Record<string, string> | undefined, key: string): string => {
  const value = params?.[key];
  if (!value || typeof value !== 'string') throw Errors.badRequest(`Missing path parameter: ${key}`);
  const trimmed = value.trim().toUpperCase(); // normalise case — 'mbbs' → 'MBBS'
  if (trimmed.length === 0 || trimmed.length > 100) throw Errors.badRequest(`Invalid ${key}`);
  if (!/^[A-Z0-9_-]+$/.test(trimmed)) throw Errors.badRequest(`Invalid ${key} format`);
  return trimmed;
};

// UUID param — separate validator for subject/chapter IDs
const extractUUID = (params: Record<string, string> | undefined, key: string): string => {
  const value = params?.[key];
  if (!value || typeof value !== 'string') throw Errors.badRequest(`Missing path parameter: ${key}`);
  const trimmed = value.trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)) {
    throw Errors.badRequest(`Invalid ${key} format`);
  }
  return trimmed;
};

// Thundering herd protection — only one Lambda fetches from Aurora on cache miss.
// Others wait briefly and retry from cache.
const withCacheLock = async <T>(
  redis: Redis,
  cacheKey: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
): Promise<T> => {
  // Try cache first
  const cached = await cacheGet<T>(cacheKey);
  if (cached) return cached;

  const lockKey = `lock:${cacheKey}`;
  const acquired = await redis.set(lockKey, '1', 'EX', 5, 'NX'); // 5s lock

  if (!acquired) {
    // Another instance is fetching — wait 150ms and retry cache
    await new Promise(r => setTimeout(r, 150));
    const retried = await cacheGet<T>(cacheKey);
    if (retried) return retried;
    // Lock not ours — fetch directly without touching the lock
    return fetchFn();
  }

  try {
    const data = await fetchFn();
    if (Array.isArray(data)) {
      await cacheSet(cacheKey, data, ttlSeconds);
    }
    return data;
  } finally {
    await redis.del(lockKey);
  }
};

// Lazy Redis client reference — avoids circular import
let _redis: Redis | null = null;
const getRedis = (): Redis => {
  if (_redis) return _redis;
  const endpoint = process.env.REDIS_ENDPOINT!;
  _redis = new Redis({ host: endpoint, port: 6379, tls: {}, connectTimeout: 3000, commandTimeout: 2000, maxRetriesPerRequest: 2, lazyConnect: true });
  return _redis;
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/courses
// Returns all active main courses (MBBS, NEET).
//
// Security audit:
// - [AUTH] buildAuthContext used — banned/deleted users blocked ✅
// - [INJ]  No user input in query ✅
// - [CACHE] Cache-first, thundering herd protected ✅
// ─────────────────────────────────────────────────────────────

export const getCourses = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    await buildAuthContext(event); // full check — banned/deleted blocked

    const cacheKey = 'courses:main';
    const courses = await withCacheLock<Course[]>(
      getRedis(),
      cacheKey,
      REDIS_TTL.SUBJECTS,
      () => query<Course>(
        `SELECT
           course_id      AS "courseId",
           name,
           type,
           display_order  AS "displayOrder"
         FROM courses
         WHERE type = 'MAIN'
           AND is_active = TRUE
         ORDER BY display_order ASC`,
      ),
    );

    return ok(courses);
  } catch (err) {
    return toResponse(err, { handler: 'course' });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/courses/:courseId/sub-courses
// Returns sub-courses under a main course (MBBS → FMGE, NEXT).
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [INJ]   courseId validated, normalised to uppercase, parameterised query ✅
// - [ENUM]  Parent verified before children fetched — consistent 404 shape ✅
// - [CACHE] Thundering herd protected ✅
// ─────────────────────────────────────────────────────────────

export const getSubCourses = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    await buildAuthContext(event);
    const courseId = extractParam(event.pathParameters, 'courseId');

    // Verify parent is a valid, active MAIN course
    const parent = await queryOne(
      `SELECT course_id FROM courses WHERE course_id = $1 AND type = 'MAIN' AND is_active = TRUE`,
      [courseId],
    );
    if (!parent) throw Errors.notFound('Course');

    const cacheKey = `courses:sub:${courseId}`;
    const subCourses = await withCacheLock<Course[]>(
      getRedis(),
      cacheKey,
      REDIS_TTL.SUBJECTS,
      () => query<Course>(
        `SELECT
           course_id        AS "courseId",
           name,
           type,
           parent_course_id AS "parentCourseId",
           display_order    AS "displayOrder"
         FROM courses
         WHERE parent_course_id = $1
           AND type = 'SUB'
           AND is_active = TRUE
         ORDER BY display_order ASC`,
        [courseId],
      ),
    );

    return ok(subCourses);
  } catch (err) {
    return toResponse(err, { handler: 'course' });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/courses/:courseId/subjects
// Returns subjects for a sub-course with factual counts per subject.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [AUTHZ] courseId verified as SUB course — no MAIN course access ✅
// - [AUTHZ] User's enrolled sub-course checked — cross-course access blocked ✅
// - [INJ]   courseId normalised + parameterised. subjectIds from DB, not user input ✅
// - [ENUM]  Consistent 404 for invalid courseId ✅
// - [CACHE] Subjects cached globally (content), counts fetched fresh (factual data) ✅
// - [PERF]  Thundering herd protected on subjects cache ✅
// ─────────────────────────────────────────────────────────────

export const getSubjects = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth = await buildAuthContext(event);
    const courseId = extractParam(event.pathParameters, 'courseId');

    // Verify it's a valid, active sub-course
    const course = await queryOne(
      `SELECT course_id FROM courses WHERE course_id = $1 AND type = 'SUB' AND is_active = TRUE`,
      [courseId],
    );
    if (!course) throw Errors.notFound('Course');

    // Enforce course access — user can only view their enrolled sub-course's subjects
    const user = await getAuthUser(auth.userId);
    if (user.profileCompleted && user.subCourse && user.subCourse !== courseId) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    const cacheKey = REDIS_KEYS.subjects(courseId);
    const subjects = await withCacheLock<Subject[]>(
      getRedis(),
      cacheKey,
      REDIS_TTL.SUBJECTS,
      () => query<Subject>(
        `SELECT
           subject_id    AS "subjectId",
           course_id     AS "courseId",
           name,
           icon_url      AS "iconUrl",
           display_order AS "displayOrder"
         FROM subjects
         WHERE course_id = $1
           AND is_active = TRUE
         ORDER BY display_order ASC`,
        [courseId],
      ),
    );

    if (subjects.length === 0) return ok([]);

    // Attach factual content counts per subject (not cached — accurate counts needed)
    // Named correctly: totalChapters and totalQuestionSets — not "attempted" (that's user-specific, tracked separately)
    const subjectIds = subjects.map(s => s.subjectId);
    const counts = await query<{ subjectId: string; totalChapters: string; totalQuestionSets: string }>(
      `SELECT
         s.subject_id                           AS "subjectId",
         COUNT(DISTINCT c.chapter_id)::text     AS "totalChapters",
         COUNT(DISTINCT qs.question_set_id)::text AS "totalQuestionSets"
       FROM subjects s
       LEFT JOIN chapters c       ON c.subject_id  = s.subject_id AND c.is_active = TRUE
       LEFT JOIN question_sets qs ON qs.chapter_id = c.chapter_id AND qs.is_active = TRUE
       WHERE s.subject_id = ANY($1::uuid[])
       GROUP BY s.subject_id`,
      [subjectIds],
    );

    const countsMap = Object.fromEntries(
      counts.map(c => [c.subjectId, {
        totalChapters:     parseInt(c.totalChapters, 10),
        totalQuestionSets: parseInt(c.totalQuestionSets, 10),
      }])
    );

    const result = subjects.map(s => ({
      ...s,
      totalChapters:     countsMap[s.subjectId]?.totalChapters     ?? 0,
      totalQuestionSets: countsMap[s.subjectId]?.totalQuestionSets ?? 0,
    }));

    return ok(result);
  } catch (err) {
    return toResponse(err, { handler: 'course' });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/courses/subjects/:subjectId/chapters
// Returns all active chapters under a subject.
//
// Security audit:
// - [AUTH]  extractClaims + targeted DB fetch — banned/deleted blocked,
//           avoids full user fetch overhead for a simple read ✅
// - [AUTHZ] Subject's courseId verified against user's enrolled subCourse ✅
// - [INJ]   subjectId validated as strict UUID format ✅
// - [ENUM]  Consistent 404 for invalid subjectId ✅
// - [CACHE] Thundering herd protected ✅
// ─────────────────────────────────────────────────────────────

export const getChapters = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const { userId } = extractClaims(event);
    const subjectId = extractUUID(event.pathParameters, 'subjectId');

    // Targeted fetch — only what we need for access control, not full user
    const [subject, user] = await Promise.all([
      queryOne<{ courseId: string }>(
        `SELECT course_id AS "courseId"
         FROM subjects
         WHERE subject_id = $1 AND is_active = TRUE`,
        [subjectId],
      ),
      queryOne<{ subCourse: string | null; profileCompleted: boolean; isBanned: boolean; deletedAt: string | null }>(
        `SELECT
           sub_course        AS "subCourse",
           profile_completed AS "profileCompleted",
           is_banned         AS "isBanned",
           deleted_at        AS "deletedAt"
         FROM users
         WHERE user_id = $1`,
        [userId],
      ),
    ]);

    // Auth checks on targeted fetch
    if (!user)            throw Errors.notFound('User');
    if (user.isBanned)    throw Errors.forbidden('Your account has been suspended');
    if (user.deletedAt)   throw Errors.notFound('User');
    if (!subject)         throw Errors.notFound('Subject');

    // Enforce course access — profile-completed users can only see their enrolled course
    if (user.profileCompleted && user.subCourse && subject.courseId !== user.subCourse) {
      throw Errors.forbidden('You are not enrolled in this course');
    }

    const cacheKey = REDIS_KEYS.chapters(subjectId);
    const chapters = await withCacheLock<Chapter[]>(
      getRedis(),
      cacheKey,
      REDIS_TTL.CHAPTERS,
      () => query<Chapter>(
        `SELECT
           chapter_id    AS "chapterId",
           subject_id    AS "subjectId",
           name,
           display_order AS "displayOrder"
         FROM chapters
         WHERE subject_id = $1
           AND is_active = TRUE
         ORDER BY display_order ASC`,
        [subjectId],
      ),
    );

    return ok(chapters);
  } catch (err) {
    return toResponse(err, { handler: 'course' });
  }
};
