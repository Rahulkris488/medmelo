/**
 * Migration Runner
 *
 * Runs all SQL migrations in order against Aurora.
 * Aurora is inside a VPC — run this from within the VPC or via an SSH tunnel.
 *
 * Usage:
 *   DB_HOST=<aurora-endpoint> DB_USER=<user> DB_PASSWORD=<pass> DB_NAME=medmelo \
 *   npx ts-node migrations/run.ts
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname);

const MIGRATION_FILES = [
  '001_create_users.sql',
  '002_create_courses.sql',
  '003_create_content.sql',
  '004_create_qbank.sql',
  '005_create_subscriptions.sql',
  '006_create_ai_quota.sql',
];

const run = async () => {
  const client = new Client({
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME     ?? 'medmelo',
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to Aurora.');

  // Migrations tracking table — ensures each file runs only once
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  for (const file of MIGRATION_FILES) {
    const { rows } = await client.query(
      'SELECT 1 FROM _migrations WHERE filename = $1',
      [file],
    );

    if (rows.length > 0) {
      console.log(`  ✓ ${file} — already applied, skipping`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');

    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`  ✓ ${file} — applied`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`  ✗ ${file} — FAILED:`, err);
      process.exit(1);
    }
  }

  await client.end();
  console.log('All migrations complete.');
};

run().catch((err) => {
  console.error('Migration runner failed:', err);
  process.exit(1);
});
