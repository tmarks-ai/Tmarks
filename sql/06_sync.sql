-- 06_sync.sql — 同步域（扩展 ↔ Worker）
--
-- sql/ 分类 schema 的同步域文件（见 sql/README.md）。本目录由
-- `wrangler d1 migrations apply` 按文件名顺序应用；正文 DDL 与注释原样
-- 承自基线迁移（0001）。

CREATE TABLE sync_devices (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT,
  platform TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sync_devices_user_seen ON sync_devices(user_id, last_seen_at DESC);

CREATE TABLE sync_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  change_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  device_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  revision TEXT NOT NULL,
  payload_json TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- id 游标分页(bootstrap/changes)依赖 AUTOINCREMENT 的单调性:
-- 清理最高 id 行后 rowid 复用会让游标漏行。
CREATE INDEX idx_sync_changes_user_id ON sync_changes(user_id, id);
CREATE INDEX idx_sync_changes_user_entity ON sync_changes(user_id, entity_type, entity_id, id DESC);

CREATE TABLE sync_entity_revisions (
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, entity_type, entity_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sync_entity_revisions_user_updated ON sync_entity_revisions(user_id, updated_at DESC);

CREATE TABLE sync_idempotency_keys (
  user_id TEXT NOT NULL,
  client_operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, client_operation_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_sync_idempotency_expires_at ON sync_idempotency_keys(expires_at);
