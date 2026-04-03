// ─────────────────────────────────────────────────────────────
// STRUCTURED LOGGER
// Outputs JSON lines — CloudWatch Logs Insights can query these directly.
// Each log line includes: level, message, service, and any extra context.
// ─────────────────────────────────────────────────────────────

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level:     LogLevel;
  service:   string;
  message:   string;
  requestId?: string;
  userId?:   string;
  [key: string]: unknown;
}

const write = (entry: LogEntry): void => {
  // CloudWatch ingests stdout as log events — JSON makes them queryable
  console.log(JSON.stringify(entry));
};

// ─────────────────────────────────────────────────────────────
// LOGGER FACTORY
// Call once per handler file: const log = createLogger('user')
// ─────────────────────────────────────────────────────────────

export const createLogger = (service: string) => ({

  info: (message: string, ctx: Record<string, unknown> = {}): void => {
    write({ level: 'info', service, message, ...ctx });
  },

  warn: (message: string, ctx: Record<string, unknown> = {}): void => {
    write({ level: 'warn', service, message, ...ctx });
  },

  error: (message: string, err: unknown, ctx: Record<string, unknown> = {}): void => {
    write({
      level:   'error',
      service,
      message,
      error:   err instanceof Error ? err.message : String(err),
      stack:   err instanceof Error ? err.stack   : undefined,
      ...ctx,
    });
  },
});

// ─────────────────────────────────────────────────────────────
// UPDATE toResponse TO LOG ALL ERRORS
// Import and use this instead of the one in errors.ts
// ─────────────────────────────────────────────────────────────

import { AppError, toResponse as baseToResponse } from './errors';
import type { ApiResponse } from './types';

const rootLogger = createLogger('root');

export const toResponse = (err: unknown, ctx: Record<string, unknown> = {}): ApiResponse => {
  if (err instanceof AppError) {
    // Expected errors — warn level (not noise, not silent)
    if (err.code !== 'BAD_REQUEST' && err.code !== 'NOT_FOUND') {
      rootLogger.warn(`AppError: ${err.code}`, { message: err.message, ...ctx });
    }
  } else {
    // Unexpected errors — always log with full stack
    rootLogger.error('Unhandled error', err, ctx);
  }

  return baseToResponse(err);
};
