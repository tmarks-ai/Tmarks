import { describe, expect, it } from 'vitest'
import { createMigratedDatabase, tableColumns, type SqliteDatabase } from './helpers/sqlite-migrations'

/**
 * The schema ships as the numbered domain files in sql/ (01–08), applied by
 * `wrangler d1 migrations apply` in lexical order. These tests pin the
 * structures that motivated the current shape so a future edit cannot
 * silently resurrect dead structures or drop a load-bearing index.
 */
describe('schema baseline', () => {
  function freshDb(): SqliteDatabase {
    return createMigratedDatabase()
  }

  it('contains exactly the expected tables', () => {
    const db = freshDb()
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((r) => r.name)
    expect(tables).toEqual([
      'api_key_logs',
      'api_key_rate_limits',
      'api_keys',
      'audit_logs',
      'auth_tokens',
      'bookmark_click_events',
      'bookmark_folders',
      'bookmark_search',
      'bookmark_search_config',
      'bookmark_search_content',
      'bookmark_search_data',
      'bookmark_search_docsize',
      'bookmark_search_idx',
      'bookmark_snapshots',
      'bookmark_tags',
      'bookmarks',
      'folder_search',
      'folder_search_config',
      'folder_search_content',
      'folder_search_data',
      'folder_search_docsize',
      'folder_search_idx',
      'public_share_pages',
      'storage_cleanup_jobs',
      'sync_changes',
      'sync_devices',
      'sync_entity_revisions',
      'sync_idempotency_keys',
      'tab_group_items',
      'tab_groups',
      'tag_search',
      'tag_search_config',
      'tag_search_content',
      'tag_search_data',
      'tag_search_docsize',
      'tag_search_idx',
      'tags',
      'user_preferences',
      'users',
    ])
    db.close()
  })

  it('dropped the dead structures: rate_limits, schema_migrations, bookmarks_fts', () => {
    const db = freshDb()
    // rate_limits: the limiter uses api_key_rate_limits; nothing read/wrote
    // these leftovers (the FTS table never had any code touching it and its
    // shadow tables vanish with it).
    for (const dead of ['rate_limits', 'schema_migrations', 'bookmarks_fts']) {
      const row = db
        .prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?')
        .get(dead) as { n: number }
      expect(row.n, dead).toBe(0)
    }
    db.close()
  })

  it('pruned redundant and unused indexes but kept every load-bearing one', () => {
    const db = freshDb()
    const indexes = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
          .all() as Array<{ name: string }>
      ).map((r) => r.name)
    )

    // Removed with the consolidation: duplicates of UNIQUE-constraint
    // auto-indexes, prefixes of wider indexes/PKs, and indexes no query ever
    // hit. They must not come back.
    for (const pruned of [
      'idx_bookmarks_url',
      'idx_bookmarks_user_url',
      'idx_bookmarks_user_normalized_url',
      'idx_api_keys_hash',
      'idx_api_keys_user',
      'idx_auth_tokens_user_id',
      'idx_bookmark_tags_bookmark',
      'idx_tab_group_items_group_id',
      'idx_tab_group_items_archived',
      'idx_tab_group_items_not_archived',
      'idx_tab_groups_is_folder',
      'idx_tab_groups_deleted',
      'idx_tab_groups_user_id',
      'idx_tab_groups_parent_id',
      'idx_tab_groups_user_parent',
      'idx_public_share_pages_slug',
    ]) {
      expect(indexes.has(pruned), `${pruned} should stay pruned`).toBe(false)
    }

    // Load-bearing survivors: the partial unique normalized-url index, the
    // LOWER() expression indexes behind case-insensitive reuse/login, the
    // 0125 search family, and the sync id-cursor indexes.
    for (const kept of [
      'idx_bookmarks_user_normalized_url_unique',
      'idx_tags_user_name',
      'idx_users_username_lower',
      'idx_users_email_lower',
      'idx_bookmarks_user_archived_pinned_created',
      'idx_bookmarks_user_archived_pinned_updated',
      'idx_bookmarks_user_archived_pinned_clicks',
      'idx_bookmarks_user_deleted_created',
      'idx_bookmarks_user_pinned_order',
      'idx_bookmarks_user_folder_position',
      // statistics.ts 最近点击 Top10 (user_id + ORDER BY last_clicked_at DESC)
      'idx_bookmarks_last_clicked',
      // GET /tags ?sort=usage (user_id + bookmark_count DESC, name ASC)
      'idx_tags_user_bookmark_count',
      'idx_sync_changes_user_id',
      'idx_sync_changes_user_entity',
      'idx_storage_cleanup_jobs_due',
    ]) {
      expect(indexes.has(kept), `${kept} must remain`).toBe(true)
    }

    // Expression semantics must survive verbatim, not degrade to a plain index.
    const tagName = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_tags_user_name'")
      .get() as { sql: string }
    expect(tagName.sql).toContain('LOWER(name)')
    const normalized = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_bookmarks_user_normalized_url_unique'")
      .get() as { sql: string }
    expect(normalized.sql).toContain('UNIQUE')
    expect(normalized.sql).toContain('WHERE deleted_at IS NULL')
    db.close()
  })

  it('enforces boolean CHECK constraints that ALTER-based migrations could not add', () => {
    const db = freshDb()
    db.prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)').run('u1', 'u1', 'x')
    db.prepare('INSERT INTO bookmarks (id, user_id, title, url, is_pinned) VALUES (?, ?, ?, ?, ?)').run(
      'bm-1',
      'u1',
      't',
      'https://example.com/a',
      1
    )
    // 0/1 pass…
    db.prepare('UPDATE bookmarks SET is_pinned = 0 WHERE id = ?').run('bm-1')
    // …anything else is rejected at the storage layer now.
    expect(() =>
      db.prepare('UPDATE bookmarks SET is_pinned = 2 WHERE id = ?').run('bm-1')
    ).toThrow(/CHECK constraint failed/)
    expect(() =>
      db.prepare("INSERT INTO api_keys (id, user_id, key_hash, key_prefix, name, permissions, status) VALUES (?, ?, ?, ?, ?, ?, 'enabled')").run(
        'k1',
        'u1',
        'h',
        'tmk_x',
        'n',
        'bookmarks.read'
      )
    ).toThrow(/CHECK constraint failed/)
    db.close()
  })

  it('keeps AUTOINCREMENT on sync_changes (id cursors must stay monotonic)', () => {
    const db = freshDb()
    const sql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sync_changes'").get() as { sql: string }
    ).sql
    expect(sql).toContain('AUTOINCREMENT')
    expect(tableColumns(db, 'bookmarks')).toContain('is_private')
    db.close()
  })

  it('lands the maintained tag counter with all five triggers', () => {
    const db = freshDb()
    // tags.bookmark_count is read directly by the tag routes, so every
    // database must end up with the column, its sort index, and the five
    // maintaining triggers from sql/04_tags.sql. Pinning them here guards
    // the schema files that every deployment walks.
    expect(tableColumns(db, 'tags')).toContain('bookmark_count')
    const triggers = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as Array<{
        name: string
      }>
    ).map((r) => r.name)
    for (const trigger of [
      'bookmark_tags_count_insert',
      'bookmark_tags_count_delete',
      'bookmark_live_state_to_trash',
      'bookmark_trash_to_live',
      'tag_trash_to_live',
    ]) {
      expect(triggers).toContain(trigger)
    }
    db.close()
  })
})
