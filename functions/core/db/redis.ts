import Redis from 'ioredis';

// ─────────────────────────────────────────────────────────────
// REDIS CLIENT
// Singleton — cached across Lambda warm invocations.
// Reads endpoint from REDIS_ENDPOINT env var.
// TLS is required (matching infra config: transitEncryptionEnabled: true)
// ─────────────────────────────────────────────────────────────

let client: Redis | null = null;

const getClient = (): Redis => {
  if (client) return client;

  const endpoint = process.env.REDIS_ENDPOINT;
  if (!endpoint) throw new Error('REDIS_ENDPOINT env var is not set');

  client = new Redis({
    host: endpoint,
    port: 6379,
    tls:  {},              // required — infra has transitEncryptionEnabled: true
    connectTimeout:  3000,
    commandTimeout:  2000,
    maxRetriesPerRequest: 2,
    lazyConnect: true,     // don't connect until first command
  });

  client.on('error', (err) => {
    console.error('[Redis error]', err.message);
  });

  return client;
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// Get a cached value — returns null if missing or expired
export const cacheGet = async <T>(key: string): Promise<T | null> => {
  const raw = await getClient().get(key);
  if (!raw) return null;
  return JSON.parse(raw) as T;
};

// Set a cached value with TTL in seconds
export const cacheSet = async (key: string, value: unknown, ttlSeconds: number): Promise<void> => {
  await getClient().set(key, JSON.stringify(value), 'EX', ttlSeconds);
};

// Delete a cached value — call this when data is updated
export const cacheDel = async (key: string): Promise<void> => {
  await getClient().del(key);
};

// Increment a counter — used for AI quota tracking
export const cacheIncr = async (key: string): Promise<number> => {
  return getClient().incr(key);
};

// Set expiry on an existing key — used after cacheIncr for quota reset
export const cacheExpire = async (key: string, ttlSeconds: number): Promise<void> => {
  await getClient().expire(key, ttlSeconds);
};
