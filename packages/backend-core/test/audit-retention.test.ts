import { afterEach, describe, expect, it, vi } from 'vitest'
import { maybePruneAuditLogs } from '../src/lib/audit/retention'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

/**
 * R5-7 regression: the 1% retention sweep used to fire `void` promises with no
 * waitUntil — on Workers the isolate may settle before the DELETEs run, so
 * audit_logs / bookmark_click_events effectively never pruned. The middleware
 * caller now passes the request's waitUntil; the prune must run (and actually
 * delete) within it.
 */
const USER = 'user-1'
const OLD = new Date(Date.now() - 91 * 24 * 3600_000).toISOString()
const FRESH = new Date().toISOString()

let harness: SqliteD1Harness | null = null

afterEach(() => {
  harness?.close()
  harness = null
  vi.restoreAllMocks()
})

function seed(h: SqliteD1Harness) {
  h.sqlite
    .prepare('INSERT INTO bookmarks (id, user_id, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('bm-1', USER, 't', 'https://example.com/a', FRESH, FRESH)
  const audit = h.sqlite.prepare('INSERT INTO audit_logs (user_id, event_type, created_at) VALUES (?, ?, ?)')
  audit.run(USER, 'auth.login_failed', OLD)
  audit.run(USER, 'auth.login_ok', FRESH)
  const click = h.sqlite.prepare('INSERT INTO bookmark_click_events (bookmark_id, user_id, clicked_at) VALUES (?, ?, ?)')
  click.run('bm-1', USER, OLD)
  click.run('bm-1', USER, FRESH)
}

describe('audit retention sweep (R5-7)', () => {
  it('attaches the sweep to the caller-provided waitUntil and prunes only expired rows', async () => {
    const h = createSqliteD1(USER)
    seed(h)
    vi.spyOn(Math, 'random').mockReturnValue(0)

    const waitUntilCalls: Array<Promise<unknown>> = []
    maybePruneAuditLogs(h.db, (promise) => waitUntilCalls.push(promise))

    // The prune promise went to waitUntil instead of floating.
    expect(waitUntilCalls).toHaveLength(1)
    await Promise.all(waitUntilCalls)

    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE event_type = ?').get('auth.login_failed')).toEqual({ n: 0 })
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE event_type = ?').get('auth.login_ok')).toEqual({ n: 1 })
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM bookmark_click_events WHERE clicked_at = ?").get(OLD)).toEqual({ n: 0 })
    expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM bookmark_click_events WHERE clicked_at = ?").get(FRESH)).toEqual({ n: 1 })
  })

  it('keeps the fire-and-forget path (no waitUntil supplied) and still prunes', async () => {
    const h = createSqliteD1(USER)
    seed(h)
    vi.spyOn(Math, 'random').mockReturnValue(0)

    maybePruneAuditLogs(h.db)

    // The prune races with the assertion on the non-Workers path; poll until
    // the old row disappears (bounded by the event loop, not real time).
    for (let i = 0; i < 50; i++) {
      const { n } = h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE event_type = ?').get('auth.login_failed') as { n: number }
      if (n === 0) break
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE event_type = ?').get('auth.login_failed')).toEqual({ n: 0 })
  })

  it('does nothing when the 1% sample misses', () => {
    const h = createSqliteD1(USER)
    seed(h)
    vi.spyOn(Math, 'random').mockReturnValue(0.99)

    const waitUntilCalls: Array<Promise<unknown>> = []
    maybePruneAuditLogs(h.db, (promise) => waitUntilCalls.push(promise))
    expect(waitUntilCalls).toHaveLength(0)
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM audit_logs').get()).toEqual({ n: 2 })
  })
})
