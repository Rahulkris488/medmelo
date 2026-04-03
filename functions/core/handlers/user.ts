import { query, queryOne, withTransaction } from '../db/client';
import { cacheDel } from '../db/redis';
import { buildAuthContext, extractClaims, getAuthUser } from '../middleware/auth';
import { REDIS_KEYS, LEGACY_MEMBER_CAP } from '../../shared/constants';
import { ok, created } from '../../shared/response';
import { Errors, toResponse } from '../../shared/errors';
import type { ApiEvent, ApiResponse, User, CompleteProfileInput } from '../../shared/types';

// ─────────────────────────────────────────────────────────────
// POST /api/v1/core/users/register
// Called by mobile immediately after Cognito signup.
// Creates the user row in Aurora with basic info.
// ─────────────────────────────────────────────────────────────

export const registerUser = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const { userId, email } = extractClaims(event);
    const body = JSON.parse(event.body ?? '{}') as { fullName: string; phone?: string };

    if (!body.fullName?.trim()) throw Errors.badRequest('fullName is required');

    // Idempotent — safe to call twice (e.g. app retry on network failure)
    const existing = await queryOne('SELECT user_id FROM users WHERE user_id = $1', [userId]);
    if (existing) {
      const user = await getAuthUser(userId);
      return ok(user);
    }

    // Check legacy cap — first 1,000 users get isLegacy = true
    const [{ count }] = await query<{ count: string }>('SELECT COUNT(*) AS count FROM users');
    const isLegacy = parseInt(count, 10) < LEGACY_MEMBER_CAP;

    const user = await queryOne<User>(
      `INSERT INTO users (user_id, full_name, email, phone, is_legacy)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING
         user_id             AS "userId",
         full_name           AS "fullName",
         email,
         phone,
         tier,
         is_legacy           AS "isLegacy",
         profile_completed   AS "profileCompleted",
         created_at          AS "createdAt",
         updated_at          AS "updatedAt"`,
      [userId, body.fullName.trim(), email, body.phone ?? null, isLegacy],
    );

    // Create empty AI quota row for this user
    await query(
      `INSERT INTO ai_quota (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      [userId],
    );

    return created(user!);
  } catch (err) {
    return toResponse(err);
  }
};

// ─────────────────────────────────────────────────────────────
// PUT /api/v1/core/users/profile
// Called after first login — completes the user profile.
// College, country, year of study, course selection.
// ─────────────────────────────────────────────────────────────

export const completeProfile = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const { userId } = extractClaims(event);
    const body = JSON.parse(event.body ?? '{}') as CompleteProfileInput;

    if (!body.college?.trim())             throw Errors.badRequest('college is required');
    if (!body.countryOfResidence?.trim())  throw Errors.badRequest('countryOfResidence is required');
    if (!body.countryOfStudy?.trim())      throw Errors.badRequest('countryOfStudy is required');
    if (!body.yearOfStudy)                 throw Errors.badRequest('yearOfStudy is required');
    if (!body.mainCourse)                  throw Errors.badRequest('mainCourse is required');
    if (!body.subCourse)                   throw Errors.badRequest('subCourse is required');

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
      [
        body.college.trim(),
        body.countryOfResidence.trim(),
        body.countryOfStudy.trim(),
        body.yearOfStudy,
        body.mainCourse,
        body.subCourse,
        userId,
      ],
    );

    if (!user) throw Errors.notFound('User');

    // Invalidate cache — next request gets fresh data with profileCompleted = true
    await cacheDel(REDIS_KEYS.user(userId));

    return ok(user);
  } catch (err) {
    return toResponse(err);
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/core/users/me
// Returns full user profile + AI quota for the profile screen.
// ─────────────────────────────────────────────────────────────

export const getMe = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const auth = await buildAuthContext(event);

    const [user, quota] = await Promise.all([
      getAuthUser(auth.userId),
      queryOne<{ queriesUsedToday: number; lastResetDate: string }>(
        `SELECT
           queries_used_today AS "queriesUsedToday",
           last_reset_date    AS "lastResetDate"
         FROM ai_quota
         WHERE user_id = $1`,
        [auth.userId],
      ),
    ]);

    return ok({ ...user, aiQuota: quota });
  } catch (err) {
    return toResponse(err);
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/core/users/me
// Deletes all user data — required by Apple & Google store policy.
// ─────────────────────────────────────────────────────────────

export const deleteMe = async (event: ApiEvent): Promise<ApiResponse> => {
  try {
    const { userId } = extractClaims(event);

    await withTransaction(async (client) => {
      // Delete in FK-safe order (children before parent)
      await client.query('DELETE FROM ai_conversations  WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM ai_quota          WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM donations         WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_ebooks       WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM subscriptions     WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM flashcard_decks   WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM users             WHERE user_id = $1', [userId]);
    });

    await cacheDel(REDIS_KEYS.user(userId));

    return ok({ message: 'Account deleted successfully' });
  } catch (err) {
    return toResponse(err);
  }
};
