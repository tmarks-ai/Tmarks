-- 02_folders.sql — 目录域
--
-- sql/ 分类 schema 的目录域文件（见 sql/README.md）。本目录由
-- `wrangler d1 migrations apply` 按文件名顺序应用；正文 DDL 与注释原样承自
-- 基线迁移（0001）与旧 0004 迁移的游标索引。

CREATE TABLE bookmark_folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT DEFAULT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  deleted_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES bookmark_folders(id) ON DELETE CASCADE
);
CREATE INDEX idx_bookmark_folders_user_deleted
  ON bookmark_folders(user_id, is_deleted);
CREATE INDEX idx_bookmark_folders_user_parent_position
  ON bookmark_folders(user_id, parent_id, position ASC);

-- 原 0004 迁移引入:同步 bootstrap 的 (user_id, id) 游标分页索引
-- (lib/sync/sync-bootstrap.ts 的 `WHERE user_id = ? AND id > ? ORDER BY id ASC`)。
CREATE INDEX IF NOT EXISTS idx_bookmark_folders_user_id_id ON bookmark_folders(user_id, id);
