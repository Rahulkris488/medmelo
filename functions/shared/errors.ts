import { badRequest, forbidden, notFound, conflict, internalError } from './response';
import type { ApiResponse } from './types';

// ─────────────────────────────────────────────────────────────
// APP ERROR
// A typed error you can throw from anywhere in the app.
// Caught in the handler and converted to the right HTTP response.
// ─────────────────────────────────────────────────────────────

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ─────────────────────────────────────────────────────────────
// ERROR CODES
// Each code maps to a specific HTTP response
// ─────────────────────────────────────────────────────────────

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'AI_QUOTA_EXCEEDED'
  | 'TIER_REQUIRED'
  | 'PROFILE_INCOMPLETE'
  | 'INTERNAL';

// ─────────────────────────────────────────────────────────────
// CONVERT AppError → ApiResponse
// Call this in every handler's catch block
// ─────────────────────────────────────────────────────────────

export const toResponse = (err: unknown): ApiResponse => {
  if (err instanceof AppError) {
    switch (err.code) {
      case 'BAD_REQUEST':       return badRequest(err.message);
      case 'NOT_FOUND':         return notFound(err.message);
      case 'FORBIDDEN':         return forbidden(err.message);
      case 'CONFLICT':          return conflict(err.message);
      case 'AI_QUOTA_EXCEEDED': return forbidden(err.message);
      case 'TIER_REQUIRED':     return forbidden(err.message);
      case 'PROFILE_INCOMPLETE':return badRequest(err.message);
      case 'INTERNAL':          return internalError();
    }
  }

  // Unknown error — log it, never expose details to client
  console.error('[UNHANDLED ERROR]', err);
  return internalError();
};

// ─────────────────────────────────────────────────────────────
// THROW HELPERS
// Shortcuts so handlers don't have to construct AppError manually
// ─────────────────────────────────────────────────────────────

export const Errors = {
  badRequest:        (msg: string)     => new AppError('BAD_REQUEST', msg),
  notFound:          (resource: string)=> new AppError('NOT_FOUND', `${resource} not found`),
  forbidden:         (msg: string)     => new AppError('FORBIDDEN', msg),
  conflict:          (msg: string)     => new AppError('CONFLICT', msg),
  aiQuotaExceeded:   ()                => new AppError('AI_QUOTA_EXCEEDED', 'Daily AI limit reached. Upgrade to Premium for unlimited access.'),
  tierRequired:      (tier: string)    => new AppError('TIER_REQUIRED', `Upgrade to ${tier} to access this feature.`),
  profileIncomplete: ()                => new AppError('PROFILE_INCOMPLETE', 'Please complete your profile first.'),
  internal:          ()                => new AppError('INTERNAL', 'Internal server error'),
};
