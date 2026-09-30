/**
 * audit_logs retention.
 *
 * Every other append-only sync table prunes itself (sync-retention.ts,
 * sync-idempotency.ts) — audit_logs was left out, so IPs, user agents,
 * usernames, and emails accumulated forever. Mirror the rate limiter's
 * probabilistic sweep: 1% of calls issue the DELETE pair; the request path
 * never waits on it.
 */
const AUDIT_LOG_RETENTION_DAYS = 90

export function maybePruneAuditLogs(
  db: D1Database,
  waitUntil?: (promise: Promise<unknown>) => void
): void {
  if (Math.random() >= 0.01) return
  const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 24 * 3600_000).toISOString()

  // R5-7: a bare `void` promise floating after the response is built has NO
  // completion guarantee on Workers — the isolate may settle first, so the
  // 1% sweep effectively never ran and the tables grew unboundedly. When the
  // caller supplies the request's waitUntil, the prune runs within the
  // invocation's lifetime; tests and non-Workers callers keep the
  // fire-and-forget path.
  const prune = async (): Promise<void> => {
    // click_events feed the statistics trend charts (30-day windows); nothing
    // else pruned them, so the table grew unboundedly and every statistics
    // call scanned more rows.
    await db
      .prepare('DELETE FROM bookmark_click_events WHERE clicked_at < ?')
      .bind(cutoff)
      .run()
      .catch(() => undefined)
    await db
      .prepare('DELETE FROM audit_logs WHERE created_at < ?')
      .bind(cutoff)
      .run()
      .catch(() => undefined)
  }

  if (waitUntil) waitUntil(prune())
  else void prune()
}
