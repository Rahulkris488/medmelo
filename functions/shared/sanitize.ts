import { Errors } from './errors';

// ─────────────────────────────────────────────────────────────
// INPUT LIMITS
// ─────────────────────────────────────────────────────────────

export const LIMITS = {
  FULL_NAME:  { min: 2,  max: 255 },
  PHONE:      { min: 7,  max: 20  },
  COLLEGE:    { min: 2,  max: 255 },
  COUNTRY:    { min: 2,  max: 100 },
  YEAR_STUDY: { min: 1,  max: 7   },
  BODY_BYTES: 8192, // 8 KB max request body
} as const;

// ─────────────────────────────────────────────────────────────
// STRING SANITIZER
// - Trims whitespace
// - Collapses internal whitespace (no double spaces)
// - Strips control characters (null bytes, escape sequences etc.)
// - Enforces min/max length
// ─────────────────────────────────────────────────────────────

export const sanitizeStr = (
  value: unknown,
  field: string,
  min: number,
  max: number,
): string => {
  if (typeof value !== 'string') throw Errors.badRequest(`${field} must be a string`);

  const cleaned = value
    .trim()
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
    .replace(/\s+/g, ' ');                               // collapse whitespace

  if (cleaned.length < min) throw Errors.badRequest(`${field} is too short (min ${min} chars)`);
  if (cleaned.length > max) throw Errors.badRequest(`${field} is too long (max ${max} chars)`);

  return cleaned;
};

// ─────────────────────────────────────────────────────────────
// EMAIL NORMALIZER
// Lowercases, trims, validates basic format.
// Prevents duplicates via casing (user@gmail.com = User@Gmail.com)
// ─────────────────────────────────────────────────────────────

export const normalizeEmail = (email: string): string => {
  const normalized = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw Errors.badRequest('Invalid email format');
  }
  return normalized;
};

// ─────────────────────────────────────────────────────────────
// BODY PARSER
// Enforces max body size before parsing JSON.
// Prevents huge/malicious payloads from reaching handlers.
// ─────────────────────────────────────────────────────────────

export const parseBody = <T>(body: string | undefined): T => {
  if (!body) return {} as T;
  if (Buffer.byteLength(body, 'utf8') > LIMITS.BODY_BYTES) {
    throw Errors.badRequest('Request body too large');
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw Errors.badRequest('Invalid JSON body');
  }
};

// ─────────────────────────────────────────────────────────────
// INTEGER VALIDATOR
// Ensures value is a real integer within range.
// Rejects floats, strings, negatives, out-of-range.
// ─────────────────────────────────────────────────────────────

export const validateInt = (value: unknown, field: string, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw Errors.badRequest(`${field} must be a whole number`);
  }
  if (value < min || value > max) {
    throw Errors.badRequest(`${field} must be between ${min} and ${max}`);
  }
  return value;
};
