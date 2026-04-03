-- ─────────────────────────────────────────────────────────────
-- 007 · USER FLAGS
-- Adds ban support and soft-delete tombstone to users table.
-- ─────────────────────────────────────────────────────────────

-- Ban support — admin can ban a user without deleting their data
ALTER TABLE users ADD COLUMN is_banned     BOOLEAN      NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN banned_reason VARCHAR(500);
ALTER TABLE users ADD COLUMN banned_at     TIMESTAMPTZ;

-- Soft-delete tombstone — keeps audit trail after account deletion
-- NULL = active, set = deleted
ALTER TABLE users ADD COLUMN deleted_at    TIMESTAMPTZ;

-- Index for fast banned/deleted lookups in auth middleware
CREATE INDEX idx_users_banned  ON users (is_banned) WHERE is_banned = TRUE;
CREATE INDEX idx_users_deleted ON users (deleted_at) WHERE deleted_at IS NOT NULL;
