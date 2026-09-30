-- 04_tags.sql — 标签域（标签、书签-标签关联、维护式计数）
--
-- sql/ 分类 schema 的标签域文件（见 sql/README.md）。本目录由
-- `wrangler d1 migrations apply` 按文件名顺序应用；正文 DDL 与注释原样承自
-- 基线迁移（0001）、旧 0004（游标/导出索引）与旧 0006（维护式计数）。
--
-- tags.bookmark_count 仍以 `ALTER TABLE` 落地（保留旧 0006 的升级形态）：
-- 本文件先建表后加列，新库效果与原生列一致（等价性由 tag-count 与
-- schema-baseline 测试钉住）。旧 0006 的存量回填 UPDATE 属数据修复，只为
-- 升级存量库存在，逐字存档于 AUDIT-2026-09-11.md 附十二。

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  click_count INTEGER NOT NULL DEFAULT 0,
  last_clicked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, name)
);
-- AI 标签复用按小写匹配(提示词承诺“优先复用已有名称”),列级 UNIQUE
-- 是二进制排序,大小写不敏感复用需要 LOWER() 表达式索引。
CREATE INDEX idx_tags_user_name ON tags(user_id, LOWER(name));
CREATE INDEX idx_tags_user_deleted ON tags(user_id, deleted_at);
CREATE INDEX idx_tags_click_count ON tags(user_id, click_count DESC);
CREATE INDEX idx_tags_last_clicked ON tags(user_id, last_clicked_at DESC);

-- 原 0004 迁移引入:同步 bootstrap 的 (user_id, id) 游标分页索引。
CREATE INDEX IF NOT EXISTS idx_tags_user_id_id ON tags(user_id, id);

-- 0006（维护式计数）:tags.bookmark_count 成为维护式计数(每标签的活书签数),
-- 标签读取面(list/get/search/statistics)直读该列。
ALTER TABLE tags ADD COLUMN bookmark_count INTEGER NOT NULL DEFAULT 0;

-- GET /tags ?sort=usage (user_id + bookmark_count DESC, name ASC) 的排序索引。
CREATE INDEX IF NOT EXISTS idx_tags_user_bookmark_count
  ON tags(user_id, bookmark_count DESC, name ASC);

CREATE TABLE bookmark_tags (
  bookmark_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (bookmark_id, tag_id),
  FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_bookmark_tags_tag_user ON bookmark_tags(tag_id, user_id);
CREATE INDEX idx_bookmark_tags_bookmark_tag_user
  ON bookmark_tags(bookmark_id, tag_id, user_id);
-- 原 0004 迁移引入:导出面 `WHERE bt.user_id = ?` 的用户前缀读取索引。
CREATE INDEX IF NOT EXISTS idx_bookmark_tags_user_bookmark ON bookmark_tags(user_id, bookmark_id);

-- 0006（维护式计数）:维护计数的五个触发器。计数语义:一条 bookmark_tags 行
-- 当且仅当其书签为活(deleted_at IS NULL)时计入;活↔回收状态迁移按"现存链接"
-- 增减;墓碑标签期间的一切链路突变对增量维护不可见,由 tag_trash_to_live 在
-- 复活时全量重算收口。时间戳用 strftime 产出与 JS toISOString() 字节相同格式。

CREATE TRIGGER bookmark_tags_count_insert
AFTER INSERT ON bookmark_tags
WHEN (SELECT deleted_at FROM bookmarks WHERE id = NEW.bookmark_id) IS NULL
BEGIN
  UPDATE tags SET bookmark_count = bookmark_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.tag_id AND user_id = NEW.user_id AND deleted_at IS NULL;
END;

CREATE TRIGGER bookmark_tags_count_delete
AFTER DELETE ON bookmark_tags
WHEN (SELECT deleted_at FROM bookmarks WHERE id = OLD.bookmark_id) IS NULL
BEGIN
  UPDATE tags SET bookmark_count = MAX(bookmark_count - 1, 0), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = OLD.tag_id AND user_id = OLD.user_id AND deleted_at IS NULL;
END;

CREATE TRIGGER bookmark_live_state_to_trash
AFTER UPDATE OF deleted_at ON bookmarks
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE tags
  SET bookmark_count = MAX(bookmark_count - 1, 0), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id IN (SELECT tag_id FROM bookmark_tags WHERE bookmark_id = NEW.id AND user_id = NEW.user_id)
    AND user_id = NEW.user_id AND deleted_at IS NULL;
END;

CREATE TRIGGER bookmark_trash_to_live
AFTER UPDATE OF deleted_at ON bookmarks
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  UPDATE tags
  SET bookmark_count = bookmark_count + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id IN (SELECT tag_id FROM bookmark_tags WHERE bookmark_id = NEW.id AND user_id = NEW.user_id)
    AND user_id = NEW.user_id AND deleted_at IS NULL;
END;

CREATE TRIGGER tag_trash_to_live
AFTER UPDATE OF deleted_at ON tags
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
  UPDATE tags SET
    bookmark_count = (
      SELECT COUNT(DISTINCT bt.bookmark_id)
      FROM bookmark_tags bt
      JOIN bookmarks b ON b.id = bt.bookmark_id
      WHERE bt.tag_id = NEW.id AND bt.user_id = NEW.user_id AND b.deleted_at IS NULL
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id AND user_id = NEW.user_id;
END;
