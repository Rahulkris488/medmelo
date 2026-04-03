import { queryOne } from '../db/client';
import { cacheGet, cacheSet } from '../db/redis';
import { REDIS_KEYS, REDIS_TTL } from '../../shared/constants';
import { Errors } from '../../shared/errors';
import type { ApiEvent, AuthContext, User } from '../../shared/types';

// ─────────────────────────────────────────────────────────────
// EXTRACT RAW CLAIMS FROM JWT
// API Gateway HTTP v2 JWT authorizer validates the token for us.
// By the time Lambda runs, the token is already verified — we just read the claims.
// ─────────────────────────────────────────────────────────────

export const extractClaims = (event: ApiEvent): { userId: string; email: string } => {
  const claims = event.requestContext?.authorizer?.jwt?.claims;

  if (!claims?.sub || !claims?.email) {
    throw Errors.forbidden('Missing or invalid token claims');
  }

  return {
    userId: claims.sub,
    email:  claims.email.toLowerCase().trim(), // normalize email at entry point
  };
};

// ─────────────────────────────────────────────────────────────
// FETCH FULL USER (cache → Aurora)
// Needed by any handler that checks tier, isLegacy, profileCompleted etc.
// Also enforces banned and deleted checks on every request.
// ─────────────────────────────────────────────────────────────

export const getAuthUser = async (userId: string): Promise<User> => {
  // 1. Check Redis cache first
  const cached = await cacheGet<User>(REDIS_KEYS.user(userId));
  if (cached) {
    // Re-check banned/deleted on cached user — cache is invalidated on ban/delete
    // but double-check in case of race between ban and cache write
    if ((cached as any).isBanned)  throw Errors.forbidden('Your account has been suspended');
    if ((cached as any).deletedAt) throw Errors.forbidden('Account not found');
    return cached;
  }

  // 2. Fetch from Aurora
  const user = await queryOne<User & { isBanned: boolean; deletedAt: string | null }>(
    `SELECT
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
       is_banned            AS "isBanned",
       deleted_at           AS "deletedAt",
       created_at           AS "createdAt",
       updated_at           AS "updatedAt"
     FROM users
     WHERE user_id = $1`,
    [userId],
  );

  // 3. User exists in Cognito but not in Aurora yet — first login
  if (!user) throw Errors.notFound('User');

  // 4. Banned — return 403, not 404 (don't leak existence)
  if (user.isBanned) throw Errors.forbidden('Your account has been suspended');

  // 5. Soft-deleted — treat as not found
  if (user.deletedAt) throw Errors.notFound('User');

  // 6. Strip internal fields before caching/returning
  const { isBanned, deletedAt, ...safeUser } = user;

  // 7. Cache clean user object
  await cacheSet(REDIS_KEYS.user(userId), safeUser, REDIS_TTL.USER);

  return safeUser;
};

// ─────────────────────────────────────────────────────────────
// BUILD AUTH CONTEXT
// Single call that does both — extract claims + fetch user.
// Use this in handlers that need the full user (tier, profile, etc.)
// ─────────────────────────────────────────────────────────────

export const buildAuthContext = async (event: ApiEvent): Promise<AuthContext> => {
  const { userId, email } = extractClaims(event);
  const user = await getAuthUser(userId);

  return {
    userId,
    email,
    tier:     user.tier,
    isLegacy: user.isLegacy,
  };
};
