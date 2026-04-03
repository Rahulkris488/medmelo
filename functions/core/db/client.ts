import { Pool, PoolClient } from 'pg';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SECRETS } from '../../shared/constants';

// ─────────────────────────────────────────────────────────────
// SECRETS MANAGER
// ─────────────────────────────────────────────────────────────

const secretsClient = new SecretsManagerClient({});

interface AuroraSecret {
  host:     string;
  port:     number;
  dbname:   string;
  username: string;
  password: string;
}

const getAuroraCredentials = async (): Promise<AuroraSecret> => {
  const command = new GetSecretValueCommand({ SecretId: SECRETS.AURORA });
  const response = await secretsClient.send(command);
  return JSON.parse(response.SecretString!) as AuroraSecret;
};

// ─────────────────────────────────────────────────────────────
// CONNECTION POOL
// Cached across Lambda warm invocations.
// On cold start: fetches credentials from Secrets Manager, creates pool.
// On warm invocations: reuses the existing pool (no Secrets Manager call).
// ─────────────────────────────────────────────────────────────

let pool: Pool | null = null;

const getPool = async (): Promise<Pool> => {
  if (pool) return pool;

  const creds = await getAuroraCredentials();

  pool = new Pool({
    host:     creds.host,
    port:     creds.port,
    database: creds.dbname,
    user:     creds.username,
    password: creds.password,
    ssl:      { rejectUnauthorized: false }, // Aurora requires SSL
    max:      5,   // Lambda: keep pool small — each instance has its own pool
    idleTimeoutMillis:    10000,
    connectionTimeoutMillis: 5000,
  });

  return pool;
};

// ─────────────────────────────────────────────────────────────
// QUERY HELPERS
// ─────────────────────────────────────────────────────────────

// Simple query — for SELECT, INSERT, UPDATE, DELETE
export const query = async <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> => {
  const db = await getPool();
  const result = await db.query(sql, params);
  return result.rows as T[];
};

// Single row — returns null if not found
export const queryOne = async <T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T | null> => {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
};

// Transaction — for operations that must succeed or fail together
export const withTransaction = async <T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> => {
  const db = await getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};
