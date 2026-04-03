import type { ApiResponse } from './types';

const headers = {
  'Content-Type': 'application/json',
};

const json = (statusCode: number, body: object): ApiResponse => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

// ─────────────────────────────────────────────────────────────
// SUCCESS
// ─────────────────────────────────────────────────────────────

export const ok = (data: object): ApiResponse =>
  json(200, { success: true, data });

export const created = (data: object): ApiResponse =>
  json(201, { success: true, data });

// ─────────────────────────────────────────────────────────────
// CLIENT ERRORS
// ─────────────────────────────────────────────────────────────

export const badRequest = (message: string): ApiResponse =>
  json(400, { success: false, error: message });

export const unauthorized = (): ApiResponse =>
  json(401, { success: false, error: 'Unauthorized' });

export const forbidden = (message = 'Access denied'): ApiResponse =>
  json(403, { success: false, error: message });

export const notFound = (resource = 'Resource'): ApiResponse =>
  json(404, { success: false, error: `${resource} not found` });

export const conflict = (message: string): ApiResponse =>
  json(409, { success: false, error: message });

// ─────────────────────────────────────────────────────────────
// SERVER ERRORS
// ─────────────────────────────────────────────────────────────

export const internalError = (): ApiResponse =>
  json(500, { success: false, error: 'Internal server error' });
