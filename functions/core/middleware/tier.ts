import { TIER_RANK } from '../../shared/constants';
import { Errors } from '../../shared/errors';
import type { AuthContext, Tier } from '../../shared/types';

// ─────────────────────────────────────────────────────────────
// TIER GATE
// Call this at the top of any handler that requires a minimum tier.
// Throws Errors.tierRequired if the user's tier is below the minimum.
// ─────────────────────────────────────────────────────────────

export const requireTier = (auth: AuthContext, minTier: Tier): void => {
  if (TIER_RANK[auth.tier] < TIER_RANK[minTier]) {
    throw Errors.tierRequired(minTier);
  }
};

// ─────────────────────────────────────────────────────────────
// TIER CHECKS
// Boolean helpers — use when you need to conditionally include
// data rather than block the entire request.
// ─────────────────────────────────────────────────────────────

export const hasTier = (auth: AuthContext, minTier: Tier): boolean =>
  TIER_RANK[auth.tier] >= TIER_RANK[minTier];

export const isFree    = (auth: AuthContext): boolean => auth.tier === 'FREE';
export const isPro     = (auth: AuthContext): boolean => auth.tier === 'PRO';
export const isVip     = (auth: AuthContext): boolean => hasTier(auth, 'VIP');
export const isPremium = (auth: AuthContext): boolean => hasTier(auth, 'PREMIUM');
export const isLegacy  = (auth: AuthContext): boolean => auth.isLegacy;
