import { logger } from '@/lib/logger'

// The persisted key registered in lib/query-client.ts. Kept as a literal here
// (rather than importing queryClient) so authStore can clear it without a
// module cycle: query-client ← authStore ← clearAuthCache.
const QUERY_CACHE_STORAGE_KEY = 'tmarks-cache'

/**
 * Drop every persisted per-user artifact on logout / session-expiry. We bypass
 * QueryClient and remove the storage entries directly so callers don't need to
 * import the query client (which would create an import cycle). In-memory
 * queries are additionally torn down by the auth-state change + navigation
 * that always accompanies a logout.
 *
 * The persister writes to sessionStorage (query-client.ts), so that area is the
 * one that actually holds bookmark titles/URLs/private notes; localStorage is
 * cleared too so an older build that persisted there is covered as well.
 */
export function clearLocalAuthArtifacts(): void {
  try {
    window.sessionStorage.removeItem(QUERY_CACHE_STORAGE_KEY)
    window.localStorage.removeItem(QUERY_CACHE_STORAGE_KEY)
  } catch (error) {
    logger.error('Failed to clear persisted query cache:', error)
  }
}
