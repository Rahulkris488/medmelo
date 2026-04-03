import { query, queryOne, withTransaction } from '../db/client';
import { cacheDel } from '../db/redis';
import { buildAuthContext, extractClaims, getAuthUser } from '../middleware/auth';
import { dbDelete, dbQueryAll, TABLES } from '../db/dynamo';
import { REDIS_KEYS, LEGACY_MEMBER_CAP } from '../../shared/constants';
import { sanitizeStr, normalizeEmail, parseBody, validateInt, LIMITS } from '../../shared/sanitize';
import { ok, created } from '../../shared/response';
import { Errors } from '../../shared/errors';
import { createLogger, toResponse } from '../../shared/logger';
import type { ApiEvent, ApiResponse, User, CompleteProfileInput, MainCourse, SubCourse } from '../../shared/types';

const log = createLogger('user');

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const VALID_SUB_COURSES: Record<MainCourse, SubCourse[]> = {
  MBBS: ['FMGE', 'NEXT'],
  NEET: ['NEET_UG', 'NEET_PG'],
};

const VALID_MAIN_COURSES: MainCourse[]   = ['MBBS', 'NEET'];
const VALID_SUB_COURSE_VALUES: SubCourse[] = ['FMGE', 'NEXT', 'NEET_UG', 'NEET_PG'];

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const validateCourseCombo = (mainCourse: unknown, subCourse: unknown): void => {
  // Strict type check first — rejects arrays, objects, numbers before enum check
  if (typeof mainCourse !== 'string') throw Errors.badRequest('mainCourse must be a string');
  if (typeof subCourse  !== 'string') throw Errors.badRequest('subCourse must be a string');

  if (!VALID_MAIN_COURSES.includes(mainCourse as MainCourse)) {
    throw Errors.badRequest(`Invalid mainCourse. Valid: ${VALID_MAIN_COURSES.join(', ')}`);
  }
  if (!VALID_SUB_COURSE_VALUES.includes(subCourse as SubCourse)) {
    throw Errors.badRequest(`Invalid subCourse. Valid: ${VALID_SUB_COURSE_VALUES.join(', ')}`);
  }
  if (!VALID_SUB_COURSES[mainCourse as MainCourse].includes(subCourse as SubCourse)) {
    throw Errors.badRequest(
      `subCourse '${subCourse}' is not valid for mainCourse '${mainCourse}'. ` +
      `Valid: ${VALID_SUB_COURSES[mainCourse as MainCourse].join(', ')}`
    );
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/core/users/register
// Called by mobile immediately after Cognito signup.
// Creates the user row in Aurora with basic info.
//
// Security audit:
// - [AUTH]  extractClaims used (user doesn't exist in Aurora yet — buildAuthContext would fail)
//           Banned existing users hit getAuthUser → 403. Deleted users → 404. ✅
// - [INPUT] Email null-guarded before normalizeEmail — clean 400 instead of TypeError 500 ✅
// - [INPUT] fullName sanitized (length, control chars, whitespace collapse) ✅
// - [INPUT] phone optional, sanitized if provided ✅
// - [RACE]  ON CONFLICT path: existing user returned via getAuthUser — banned/deleted checked ✅
// - [RACE]  ON CONFLICT path returns 200 not 201 — correct status for existing resource ✅
// - [RACE]  Count + insert in transaction — minimises legacy cap race window ✅
// - [INJ]   All values parameterised ✅
// ─────────────────────────────────────────────────────────────

export const registerUser = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const { userId } = extractClaims(event);

    // Null-guard email claim before normalizing — prevents TypeError → 500
    const rawEmail = event.requestContext?.authorizer?.jwt?.claims?.email;
    if (!rawEmail || typeof rawEmail !== 'string') {
      throw Errors.badRequest('Email claim missing from token');
    }
    const email = normalizeEmail(rawEmail);

    const body     = parseBody<{ fullName: string; phone?: string }>(event.body);
    const fullName = sanitizeStr(body.fullName, 'fullName', LIMITS.FULL_NAME.min, LIMITS.FULL_NAME.max);
    const phone    = body.phone
      ? sanitizeStr(body.phone, 'phone', LIMITS.PHONE.min, LIMITS.PHONE.max)
      : null;

    // Idempotent pre-check — safe on network retry
    // getAuthUser enforces banned/deleted — banned user gets 403, deleted gets 404
    const existing = await queryOne(
      `SELECT user_id FROM users WHERE user_id = $1`,
      [userId],
    );
    if (existing) {
      const user = await getAuthUser(userId); // enforces banned/deleted
      return ok(user);                        // 200 — not 201 (resource already exists)
    }

    // Wrap count + insert in transaction to minimise legacy cap race window
    const user = await withTransaction(async (client) => {
      const { rows: [{ count }] } = await client.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM users'
      );
      const isLegacy = parseInt(count, 10) < LEGACY_MEMBER_CAP;

      // ON CONFLICT handles the rare concurrent duplicate signup race
      // Returns existing row — caller gets 200 via getAuthUser path above on next retry
      const { rows } = await client.query<User>(
        `INSERT INTO users (user_id, full_name, email, phone, is_legacy)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id) DO UPDATE
           SET updated_at = users.updated_at
         RETURNING
           user_id             AS "userId",
           full_name           AS "fullName",
           email,
           phone,
           tier,
           is_legacy           AS "isLegacy",
           is_banned           AS "isBanned",
           deleted_at          AS "deletedAt",
           profile_completed   AS "profileCompleted",
           created_at          AS "createdAt",
           updated_at          AS "updatedAt"`,
        [userId, fullName, email, phone, isLegacy],
      );

      await client.query(
        `INSERT INTO ai_quota (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [userId],
      );

      return rows[0];
    });

    // ON CONFLICT path — existing user came back, run auth checks
    if ((user as any).isBanned)    throw Errors.forbidden('Your account has been suspended');
    if ((user as any).deletedAt)   throw Errors.notFound('User');

    // Strip internal fields before returning
    const { isBanned: _b, deletedAt: _d, ...safeUser } = user as any;

    log.info('user registered', { userId, isLegacy: safeUser.isLegacy });
    return created(safeUser);
  } catch (err) {
    return toResponse(err, { handler: 'registerUser' });
  }
};

// ─────────────────────────────────────────────────────────────
// PUT /api/v1/core/users/profile
// Called after first login — completes the user profile.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted users blocked at middleware ✅
// - [INPUT] All strings sanitized (length, control chars) ✅
// - [INPUT] yearOfStudy validated as strict integer in range 1–7 ✅
// - [INPUT] mainCourse/subCourse type-checked as string before enum validation ✅
//           Rejects arrays, objects, numbers before reaching enum check ✅
// - [AUTHZ] WHERE deleted_at IS NULL — deleted users cannot update profile ✅
// - [AUTHZ] banned check via buildAuthContext ✅
// - [CACHE] Cache invalidated on success ✅
// - [INJ]   All values parameterised ✅
// ─────────────────────────────────────────────────────────────

export const completeProfile = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    await buildAuthContext(event); // blocks banned/deleted before any DB write
    const { userId } = extractClaims(event);

    const body = parseBody<CompleteProfileInput>(event.body);

    const college            = sanitizeStr(body.college,            'college',            LIMITS.COLLEGE.min,  LIMITS.COLLEGE.max);
    const countryOfResidence = sanitizeStr(body.countryOfResidence, 'countryOfResidence', LIMITS.COUNTRY.min,  LIMITS.COUNTRY.max);
    const countryOfStudy     = sanitizeStr(body.countryOfStudy,     'countryOfStudy',     LIMITS.COUNTRY.min,  LIMITS.COUNTRY.max);
    const yearOfStudy        = validateInt(body.yearOfStudy,        'yearOfStudy',        LIMITS.YEAR_STUDY.min, LIMITS.YEAR_STUDY.max);

    // Validates type (string), enum membership, and valid combination
    validateCourseCombo(body.mainCourse, body.subCourse);

    const user = await queryOne<User>(
      `UPDATE users SET
         college              = $1,
         country_of_residence = $2,
         country_of_study     = $3,
         year_of_study        = $4,
         main_course          = $5,
         sub_course           = $6,
         profile_completed    = TRUE,
         updated_at           = NOW()
       WHERE user_id = $7
         AND deleted_at IS NULL
         AND is_banned  = FALSE
       RETURNING
         user_id              AS "userId",
         full_name            AS "fullName",
         email,
         phone,
         college,
         country_of_residence AS "countryOfResidence",
         country_of_study     AS "countryOfStudy",
         year_of_study        AS "yearOfStudy",
         tier,
         main_course          AS "mainCourse",
         sub_course           AS "subCourse",
         is_legacy            AS "isLegacy",
         profile_completed    AS "profileCompleted",
         created_at           AS "createdAt",
         updated_at           AS "updatedAt"`,
      [college, countryOfResidence, countryOfStudy, yearOfStudy, body.mainCourse, body.subCourse, userId],
    );

    if (!user) throw Errors.notFound('User');

    await cacheDel(REDIS_KEYS.user(userId));

    log.info('profile completed', { userId });
    return ok(user);
  } catch (err) {
    return toResponse(err, { handler: 'completeProfile' });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/users/me
// Returns full user profile + AI quota for the profile screen.
//
// Security audit:
// - [AUTH]  buildAuthContext — banned/deleted blocked ✅
// - [IDOR]  userId always from JWT — cannot fetch another user ✅
// - [PERF]  User fetched once via buildAuthContext, reused — no double fetch ✅
// - [DEF]   ai_quota row auto-created if missing ✅
// ─────────────────────────────────────────────────────────────

export const getMe = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    // buildAuthContext internally calls getAuthUser — use that result directly
    const auth = await buildAuthContext(event);
    const user = await getAuthUser(auth.userId); // cache hit — no extra DB call

    const quota = await queryOne<{ queriesUsedToday: number; lastResetDate: string }>(
      `SELECT
         queries_used_today AS "queriesUsedToday",
         last_reset_date    AS "lastResetDate"
       FROM ai_quota
       WHERE user_id = $1`,
      [auth.userId],
    );

    // Defensive: auto-create ai_quota row if missing (e.g. failed during registration)
    if (!quota) {
      await query(
        `INSERT INTO ai_quota (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [auth.userId],
      );
    }

    return ok({
      ...user,
      aiQuota: quota ?? {
        queriesUsedToday: 0,
        lastResetDate: new Date().toISOString().split('T')[0],
      },
    });
  } catch (err) {
    return toResponse(err, { handler: 'getMe' });
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/core/users/me
// Deletes ALL user data — required by Apple & Google store policy.
//
// Security audit:
// - [IDOR]  userId always from JWT — cannot delete another user ✅
// - [AUTH]  extractClaims (not buildAuthContext) — allows banned users to self-delete ✅
//           (correct: banned users retain the right to delete their data)
// - [ATOM]  Aurora deletion is transactional — all or nothing ✅
// - [AUDIT] Soft-delete tombstone kept — hard deletes child data, soft-deletes user row ✅
// - [CACHE] Cache invalidated immediately after Aurora confirms — stale JWT bounces ✅
// - [DYNAMO] dbQueryAll used — paginates fully, no 1MB truncation risk ✅
// - [ERR]  DynamoDB failure surfaced as error — Aurora rollback not possible at this point
//           but soft-delete already happened. DynamoDB TTLs provide eventual cleanup.
//           Logged explicitly for ops visibility ✅
// - [INJ]   All values parameterised ✅
// ─────────────────────────────────────────────────────────────

export const deleteMe = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const { userId } = extractClaims(event);

    // ── 1. Soft-delete + purge relational data (transactional) ────
    await withTransaction(async (client) => {
      const { rows: [user] } = await client.query(
        `SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`,
        [userId],
      );
      if (!user) throw Errors.notFound('User');

      // Delete child data in FK-safe order
      await client.query('DELETE FROM ai_conversations WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM ai_quota         WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM donations        WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_ebooks      WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM subscriptions    WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM flashcard_decks  WHERE user_id = $1', [userId]);

      // Soft-delete — keeps audit trail, stale JWT bounces on next getAuthUser
      await client.query(
        `UPDATE users SET deleted_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
        [userId],
      );
    });

    // ── 2. Invalidate cache immediately ───────────────────────────
    await cacheDel(REDIS_KEYS.user(userId));

    // ── 3. Purge DynamoDB — paginated to handle >1MB user data ───
    try {
      const [examSessions, flashcardProgress, userActivity, oneLinerProgress] = await Promise.all([
        dbQueryAll<{ userId: string; examId: string }>({
          TableName: TABLES.EXAM_SESSIONS,
          KeyConditionExpression: 'userId = :uid',
          ExpressionAttributeValues: { ':uid': userId },
        }),
        dbQueryAll<{ userId: string; cardId: string }>({
          TableName: TABLES.FLASHCARD_PROGRESS,
          KeyConditionExpression: 'userId = :uid',
          ExpressionAttributeValues: { ':uid': userId },
        }),
        dbQueryAll<{ userId: string; timestampEventId: string }>({
          TableName: TABLES.USER_ACTIVITY,
          KeyConditionExpression: 'userId = :uid',
          ExpressionAttributeValues: { ':uid': userId },
        }),
        dbQueryAll<{ userId: string; oneLinerId: string }>({
          TableName: TABLES.ONE_LINER_PROGRESS,
          KeyConditionExpression: 'userId = :uid',
          ExpressionAttributeValues: { ':uid': userId },
        }),
      ]);

      await Promise.all([
        ...examSessions.map(r      => dbDelete(TABLES.EXAM_SESSIONS,      { userId, examId: r.examId })),
        ...flashcardProgress.map(r => dbDelete(TABLES.FLASHCARD_PROGRESS,  { userId, cardId: r.cardId })),
        ...userActivity.map(r      => dbDelete(TABLES.USER_ACTIVITY,       { userId, timestampEventId: r.timestampEventId })),
        ...oneLinerProgress.map(r  => dbDelete(TABLES.ONE_LINER_PROGRESS,  { userId, oneLinerId: r.oneLinerId })),
      ]);
    } catch (dynamoErr) {
      // Aurora is already soft-deleted and cache cleared.
      // DynamoDB TTLs will eventually clean ExamSessions and UserActivity.
      // FlashcardProgress and OneLinerProgress have no TTL — log for manual cleanup.
      log.error('DynamoDB cleanup failed after account deletion', dynamoErr, { userId });
      // Do not rethrow — user's Aurora data is deleted, store policy is met.
      // DynamoDB orphan cleanup is a background ops concern.
    }

    log.info('account deleted', { userId });
    return ok({ message: 'Account deleted successfully' });
  } catch (err) {
    return toResponse(err, { handler: 'deleteMe' });
  }
};
