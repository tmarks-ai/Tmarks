-- 08_storage_cleanup.sql — durable R2 deletion outbox
--
-- D1 owns the rows that make storage keys reachable. A best-effort R2 delete
-- must therefore be recorded in the same D1 commit as the row deletion, so a
-- failed delete can be retried without losing the key.

CREATE TABLE storage_cleanup_jobs (
  storage_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('snapshot', 'asset')),
  user_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_storage_cleanup_jobs_due
  ON storage_cleanup_jobs(next_retry_at, created_at);
