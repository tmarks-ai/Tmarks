-- 07_share_and_search.sql — 分享与搜索域
--
-- sql/ 分类 schema 的分享与搜索域文件（见 sql/README.md）。本目录由
-- `wrangler d1 migrations apply` 按文件名顺序应用；正文 DDL 与注释原样承自
-- 基线迁移（0001）与旧 0005 迁移的 FTS5 搜索基线。

CREATE TABLE public_share_pages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  title TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 原 0005 迁移引入:FTS5 搜索基线——每个可搜索实体一张索引表,user_id + 实体 id
-- 为 UNINDEXED 列,匹配后免 JOIN 过滤与回行。刻意保持占位:目前无填充触发器、
-- 无查询路径(搜索现为 routes/search.ts 的 LIKE 方案),首个查询它的功能提交
-- 再一并接上;影子表(bookmark_search_config/content/data/docsize/idx 及
-- tag/folder 孪生)由 FTS5 模块自建,已钉在 schema-baseline 测试中。

CREATE VIRTUAL TABLE bookmark_search USING fts5(
  title,
  description,
  url,
  user_id UNINDEXED,
  bookmark_id UNINDEXED
);

CREATE VIRTUAL TABLE tag_search USING fts5(
  name,
  user_id UNINDEXED,
  tag_id UNINDEXED
);

CREATE VIRTUAL TABLE folder_search USING fts5(
  name,
  user_id UNINDEXED,
  folder_id UNINDEXED
);
