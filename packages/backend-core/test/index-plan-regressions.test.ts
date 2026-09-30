import { afterEach, describe, expect, it } from 'vitest'
import { createMigratedDatabase, type SqliteDatabase } from './helpers/sqlite-migrations'

/**
 * Index plan regressions (these indexes first shipped as migration 0004,
 * now in sql/02–04): the sync bootstrap pages, the click-event retention
 * prune and the export's bookmark_tags read were all full scans
 * (EXPLAIN: "SCAN …" + "USE TEMP B-TREE FOR ORDER BY"). These tests pin the
 * plans so a future schema or index change cannot silently regress to them.
 */

const USER = 'plan-user'

let db: SqliteDatabase | null = null

function plan(sql: string, ...params: unknown[]): string {
  db ??= createMigratedDatabase()
  return (
    (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{ detail: string }>)
      .map((row) => row.detail)
      .join(' | ')
  )
}

afterEach(() => {
  db?.close()
  db = null
})

describe('sync bootstrap id-cursor pages', () => {
  it('tags, bookmark_folders and tab_groups seek (user_id, id) instead of re-sorting the full set', () => {
    const cases: Array<[table: string, cols: string]> = [
      ['tags', 'id, name, color, click_count, last_clicked_at, created_at, updated_at, deleted_at'],
      ['bookmark_folders', 'id, name, parent_id, position, is_deleted, deleted_at, created_at, updated_at'],
      ['tab_groups', 'id, title, parent_id, is_folder, position, color, tags, is_locked, revision, created_at, updated_at, deleted_at, is_deleted'],
    ]
    for (const [table, cols] of cases) {
      const detail = plan(
        `SELECT ${cols} FROM ${table} WHERE user_id = ? AND id > ? ORDER BY id ASC LIMIT 500`,
        USER,
        'zzz'
      )
      expect(detail, table).toContain(`idx_${table}_user_id_id`)
      expect(detail, table).toContain('user_id=?')
      expect(detail, table).not.toContain(`SCAN ${table}`)
      expect(detail, table).not.toContain('TEMP B-TREE')
    }
  })

  it('bookmarks still uses its 0002 (user_id, id) index', () => {
    const detail = plan(
      `SELECT id, title FROM bookmarks WHERE user_id = ? AND id > ? ORDER BY id ASC LIMIT 500`,
      USER,
      'zzz'
    )
    expect(detail).toContain('idx_bookmarks_user_id_id')
    expect(detail).not.toContain('SCAN bookmarks')
    expect(detail).not.toContain('TEMP B-TREE')
  })

  it('tab_group_item pages drive off the PK range via CROSS JOIN and probe the joined group', () => {
    const detail = plan(
      `SELECT tgi.id, tgi.group_id FROM tab_group_items tgi
       CROSS JOIN tab_groups tg ON tg.id = tgi.group_id
       WHERE tg.user_id = ? AND tgi.id > ?
       ORDER BY tgi.id ASC LIMIT 500`,
      USER,
      'zzz'
    )
    // No user_id column exists on tab_group_items, so there is no composite to
    // add — the CROSS JOIN pins the PK range walk (id ASC streams in order,
    // no re-sort) with a per-row group probe applying the user predicate.
    expect(detail).not.toContain('SCAN tgi')
    expect(detail).not.toContain('SCAN tab_group_items')
    expect(detail).not.toContain('TEMP B-TREE')
  })
})

describe('retention prune and export reads', () => {
  it('the click-event prune uses the bare clicked_at index', () => {
    const detail = plan('DELETE FROM bookmark_click_events WHERE clicked_at < ?', '2000-01-01')
    expect(detail).toContain('idx_bookmark_click_events_clicked_at')
    expect(detail).not.toContain('SCAN bookmark_click_events')
  })

  it('the export bookmark_tags read uses the user-leading index', () => {
    const detail = plan(
      `SELECT bt.bookmark_id, bt.tag_id, t.name as tag_name
       FROM bookmark_tags bt JOIN tags t ON bt.tag_id = t.id
       WHERE bt.user_id = ?`,
      USER
    )
    expect(detail).toContain('idx_bookmark_tags_user_bookmark')
    expect(detail).not.toContain('SCAN bt')
    expect(detail).not.toContain('SCAN bookmark_tags')
  })
})
