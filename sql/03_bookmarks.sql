-- 03_bookmarks.sql — 书签域（书签、点击事件、快照）
--
-- sql/ 分类 schema 的书签域文件（见 sql/README.md）。本目录由
-- `wrangler d1 migrations apply` 按文件名顺序应用；正文 DDL 与注释原样承自
-- 基线迁移（0001）、旧 0002（(user_id, id) 游标索引）、旧 0003（两臂排序
-- 索引）与旧 0004（清理/导出索引）。

CREATE TABLE bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  cover_image TEXT,
  favicon TEXT,
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  is_todo INTEGER NOT NULL DEFAULT 0 CHECK (is_todo IN (0, 1)),
  is_private INTEGER NOT NULL DEFAULT 0 CHECK (is_private IN (0, 1)),
  click_count INTEGER NOT NULL DEFAULT 0,
  last_clicked_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  pin_order INTEGER NOT NULL DEFAULT 0,
  revision TEXT,
  normalized_url TEXT,
  folder_id TEXT DEFAULT NULL REFERENCES bookmark_folders(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, url)
);
-- normalized_url 每用户唯一(未删除行):防止同一页面的 http/https、
-- 尾斜杠变体重复收藏;check-url/create/回收站恢复都依赖它。
CREATE UNIQUE INDEX idx_bookmarks_user_normalized_url_unique
  ON bookmarks(user_id, normalized_url)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_bookmarks_user_deleted ON bookmarks(user_id, deleted_at);
-- 下列列表/筛选索引为 0125 搜索优化引入,保留全部:
CREATE INDEX idx_bookmarks_user_created ON bookmarks(user_id, created_at DESC);
CREATE INDEX idx_bookmarks_user_archived_created ON bookmarks(user_id, is_archived, created_at DESC);
CREATE INDEX idx_bookmarks_user_archived_updated ON bookmarks(user_id, is_archived, updated_at DESC);
CREATE INDEX idx_bookmarks_user_archived_pinned_created ON bookmarks(user_id, is_archived, is_pinned DESC, created_at DESC);
CREATE INDEX idx_bookmarks_user_archived_pinned_updated ON bookmarks(user_id, is_archived, is_pinned DESC, updated_at DESC);
CREATE INDEX idx_bookmarks_user_archived_pinned_clicks ON bookmarks(user_id, is_archived, is_pinned DESC, click_count DESC, last_clicked_at DESC);
CREATE INDEX idx_bookmarks_pinned ON bookmarks(user_id, is_pinned, created_at DESC);
CREATE INDEX idx_bookmarks_user_pinned_order
  ON bookmarks(user_id, is_pinned DESC, pin_order ASC, created_at DESC);
CREATE INDEX idx_bookmarks_click_count ON bookmarks(user_id, click_count DESC);
-- 统计页「最近点击 Top10」:WHERE user_id + ORDER BY last_clicked_at DESC。
CREATE INDEX idx_bookmarks_last_clicked ON bookmarks(user_id, last_clicked_at DESC);
CREATE INDEX idx_bookmarks_user_deleted_created
  ON bookmarks(user_id, deleted_at, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_bookmarks_user_folder
  ON bookmarks(user_id, folder_id, deleted_at);
CREATE INDEX idx_bookmarks_user_folder_position
  ON bookmarks(user_id, folder_id, position ASC);

-- 原 0002 迁移引入:bulk/reorder 的 `WHERE user_id = ? AND id IN (…)` 点查与
-- bootstrap 的 id 游标分页共用的 (user_id, id) 前缀索引。
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_id_id ON bookmarks(user_id, id);

-- 原 0003 迁移引入:两臂列表查询未固定前缀排序的补充索引(updated/popular 两臂)。
CREATE INDEX IF NOT EXISTS idx_bookmarks_user_pinned_updated
  ON bookmarks(user_id, is_pinned, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_pinned_clicks
  ON bookmarks(user_id, is_pinned, click_count DESC);

CREATE TABLE bookmark_click_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bookmark_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_bookmark_click_events_bookmark_clicked_at
  ON bookmark_click_events(bookmark_id, clicked_at DESC);
CREATE INDEX idx_bookmark_click_events_user_clicked_at
  ON bookmark_click_events(user_id, clicked_at DESC);
-- 原 0004 迁移引入:留存清理的全局 `clicked_at < ?` 删除(既有索引均为复合尾列)。
CREATE INDEX IF NOT EXISTS idx_bookmark_click_events_clicked_at ON bookmark_click_events(clicked_at);

CREATE TABLE bookmark_snapshots (
  id TEXT PRIMARY KEY,
  bookmark_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  snapshot_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/html; charset=utf-8',
  content_size INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (bookmark_id, version),
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_bookmark_snapshots_bookmark ON bookmark_snapshots(bookmark_id, version DESC);
CREATE INDEX idx_bookmark_snapshots_user ON bookmark_snapshots(user_id, created_at DESC);
