/**
 * Verify the D1 schema is present before the Worker serves traffic.
 *
 * The schema ships as the numbered domain files in sql/; these probes cover
 * one structural column per subsystem so a database that is empty, partially
 * restored, or from an incompatible schema generation fails closed (503)
 * instead of causing runtime SQL errors deep in request handling.
 */
const PROBE_QUERIES = [
  // Account root table
  'SELECT 1 FROM users LIMIT 1',
  // Bookmark privacy column (newest generation of the bookmark table)
  'SELECT is_private FROM bookmarks LIMIT 1',
  // auth_tokens session liveness (web auth)
  'SELECT session_id FROM auth_tokens LIMIT 1',
  // Snapshot storage (R2-backed page captures)
  'SELECT storage_key FROM bookmark_snapshots LIMIT 1',
  // Public share pages
  'SELECT slug FROM public_share_pages LIMIT 1',
  // Core data domains used by the mounted v1 routes
  'SELECT id FROM bookmark_folders LIMIT 1',
  'SELECT id FROM tags LIMIT 1',
  'SELECT bookmark_id FROM bookmark_tags LIMIT 1',
  'SELECT id FROM tab_groups LIMIT 1',
  'SELECT id FROM sync_changes LIMIT 1',
  'SELECT user_id FROM sync_idempotency_keys LIMIT 1',
  'SELECT user_id FROM sync_entity_revisions LIMIT 1',
  // Durable R2 deletion outbox
  'SELECT storage_key FROM storage_cleanup_jobs LIMIT 1',
] as const

export async function checkMigrationsApplied(
  db: D1Database,
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const sql of PROBE_QUERIES) {
    try {
      await db.prepare(sql).first()
    } catch {
      return {
        ok: false,
        error: `D1 schema is not fully migrated (failed probe: ${sql}). Run \`wrangler d1 migrations apply\` before serving traffic.`,
      }
    }
  }
  return { ok: true }
}
