import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitSyncChange } from '../src/lib/sync/sync-emit'
import { createSqliteD1 } from './helpers/sqlite-d1'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src')

/** Tables whose rows the extension mirrors and therefore must hear about. */
const SYNCED_TABLES = ['bookmarks', 'bookmark_folders', 'tags', 'tab_groups', 'tab_group_items']

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return walk(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

describe('REST mutations emit sync changes', () => {
  /**
   * Regression: `recordSyncChange` was only ever called from the extension's
   * push endpoint. Every REST write — the entire web app — was invisible to the
   * extension's incremental pull, which only converged on the 24h bootstrap,
   * and a delete made on the web could be undone by a stale extension push.
   *
   * Enforced structurally rather than per-route so a newly added handler that
   * writes to a synced table cannot quietly reintroduce the divergence.
   */
  it('every handler that writes a synced table also emits', () => {
    const offenders: string[] = []

    for (const file of [...walk(join(SRC, 'routes')), ...walk(join(SRC, 'lib', 'bookmarks'))]) {
      const source = readFileSync(file, 'utf8')
      const writes = SYNCED_TABLES.filter((table) =>
        new RegExp(`(UPDATE ${table} SET|INSERT INTO ${table}\\b|DELETE FROM ${table}\\b)`).test(source)
      )
      if (writes.length === 0) continue
      if (!source.includes('emitSyncChange')) {
        offenders.push(`${file.slice(SRC.length + 1)} writes ${writes.join(', ')}`)
      }
    }

    expect(offenders, 'these handlers mutate synced data without recording a sync change').toEqual([])
  })
})

describe('emitSyncChange', () => {
  it('records the change and advances the entity revision', async () => {
    const harness = createSqliteD1('user-1')
    harness.sqlite
      .prepare(`INSERT INTO bookmarks (id, user_id, title, url, revision) VALUES (?, ?, ?, ?, ?)`)
      .run('bm-1', 'user-1', 'T', 'https://a.example/', 'rev-old')

    await emitSyncChange(harness.db, 'user-1', 'bookmark', 'bm-1', 'upsert')

    const change = harness.sqlite
      .prepare('SELECT entity_type, entity_id, operation, revision FROM sync_changes WHERE user_id = ?')
      .get('user-1') as { entity_type: string; entity_id: string; operation: string; revision: string }
    expect(change).toMatchObject({ entity_type: 'bookmark', entity_id: 'bm-1', operation: 'upsert' })

    // The revision bump is what makes a stale push conflict rather than
    // silently overwrite; the change row must carry the new value.
    const row = harness.sqlite.prepare('SELECT revision FROM bookmarks WHERE id = ?').get('bm-1') as { revision: string }
    expect(row.revision).not.toBe('rev-old')
    expect(row.revision).toBe(change.revision)
    harness.close()
  })

  it('tracks revisions in sync_entity_revisions for tables without the column', async () => {
    const harness = createSqliteD1('user-1')
    harness.sqlite
      .prepare(`INSERT INTO tags (id, user_id, name) VALUES (?, ?, ?)`)
      .run('tag-1', 'user-1', 'alpha')

    await emitSyncChange(harness.db, 'user-1', 'tag', 'tag-1', 'upsert')

    const revision = harness.sqlite
      .prepare('SELECT revision FROM sync_entity_revisions WHERE user_id = ? AND entity_type = ? AND entity_id = ?')
      .get('user-1', 'tag', 'tag-1')
    expect(revision).toBeTruthy()
    harness.close()
  })

  it('still tombstones a hard-deleted row', async () => {
    const harness = createSqliteD1('user-1')
    // No bookmark row at all — the delete already happened.
    await emitSyncChange(harness.db, 'user-1', 'bookmark', 'gone', 'delete')

    const change = harness.sqlite
      .prepare('SELECT entity_id, operation, payload_json FROM sync_changes WHERE user_id = ?')
      .get('user-1') as { entity_id: string; operation: string; payload_json: string }
    expect(change).toMatchObject({ entity_id: 'gone', operation: 'delete' })
    expect(change.payload_json).toBe('null')
    harness.close()
  })
})
