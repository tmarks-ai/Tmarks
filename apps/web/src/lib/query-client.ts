import { QueryClient } from '@tanstack/react-query'
import { persistQueryClient } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { ApiError } from '@tmarks/contracts'

// Session storage, not localStorage: bookmarks can include private notes and
// descriptions, and a durable on-disk cache would outlive a logout on a shared
// machine. The session-only cache still delivers the persistence benefit
// (no refetch on every route change) while dying with the tab.
const persister = createSyncStoragePersister({
  storage: window.sessionStorage,
  key: 'tmarks-cache',
  serialize: JSON.stringify,
  deserialize: JSON.parse,
})

// Retry only what can heal: network failures (status 0) and 5xx. Retrying a
// 4xx just burns the quota and delays the error the UI is about to show.
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false
  if (error instanceof ApiError) {
    return error.status === 0 || error.status >= 500
  }
  // Non-ApiError failures (fetch rejects) are network-level.
  return true
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: shouldRetry,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      // Never retry automatically: every mutation here is non-idempotent
      // (POST /bookmarks, batch actions), so a retry after a network blip on a
      // request the server had already committed creates a duplicate.
      retry: 0,
    },
  },
})

/**
 * Query-key prefixes that must never be persisted: they carry
 * account-sensitive payloads (API keys, share settings, per-user prefs) and the
 * persisted cache outlives a logout unless explicitly cleared.
 *
 * Prefix match, not exact match: 'public-share-settings' (the settings form)
 * and 'public-share' (the rendered page) both descend from the same sensitive
 * root — an exact match here previously let the share slug dehydrate into
 * sessionStorage.
 */
const SENSITIVE_QUERY_KEY_PREFIXES = ['api-keys', 'public-share', 'preferences']

function isSensitiveQueryKey(queryKey: readonly unknown[]): boolean {
  const rootKey = Array.isArray(queryKey) ? String(queryKey[0]) : String(queryKey)
  return SENSITIVE_QUERY_KEY_PREFIXES.some((prefix) => rootKey === prefix || rootKey.startsWith(`${prefix}-`))
}

persistQueryClient({
  queryClient,
  persister,
  maxAge: 24 * 60 * 60 * 1000,
  buster: 'v2-session',
  dehydrateOptions: {
    shouldDehydrateQuery: (query) => !isSensitiveQueryKey(query.queryKey),
  },
})
