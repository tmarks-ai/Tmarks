-- 05_tab_groups.sql — 标签组域
--
-- sql/ 分类 schema 的标签组域文件（见 sql/README.md）。本目录由
-- `wrangler d1 migrations apply` 按文件名顺序应用；正文 DDL 与注释原样承自
-- 基线迁移（0001）与旧 0004 迁移的游标索引。

CREATE TABLE tab_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  parent_id TEXT DEFAULT NULL,
  is_folder INTEGER NOT NULL DEFAULT 0 CHECK (is_folder IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT DEFAULT NULL,
  tags TEXT DEFAULT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0 CHECK (is_deleted IN (0, 1)),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  deleted_at TEXT DEFAULT NULL,
  revision TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_tab_groups_user_created ON tab_groups(user_id, created_at DESC);
CREATE INDEX idx_tab_groups_parent_position ON tab_groups(parent_id, position ASC);
CREATE INDEX idx_tab_groups_user_parent_position
  ON tab_groups(user_id, parent_id, position ASC);

-- 原 0004 迁移引入:同步 bootstrap 的 (user_id, id) 游标分页索引。
CREATE INDEX IF NOT EXISTS idx_tab_groups_user_id_id ON tab_groups(user_id, id);

CREATE TABLE tab_group_items (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  favicon TEXT,
  position INTEGER NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  is_todo INTEGER NOT NULL DEFAULT 0 CHECK (is_todo IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  is_locked INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (group_id) REFERENCES tab_groups(id) ON DELETE CASCADE
);
CREATE INDEX idx_tab_group_items_group_created ON tab_group_items(group_id, created_at ASC);
CREATE INDEX idx_tab_group_items_pinned ON tab_group_items(group_id, is_pinned DESC, position ASC);
