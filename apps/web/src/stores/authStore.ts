import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AuthUserDTO } from '@tmarks/contracts'
import { authService } from '@/services/auth'
import { logger } from '@/lib/logger'
import { clearLocalAuthArtifacts } from '@/lib/clear-auth-cache'

// Module-level single-flight guard: prevents concurrent refresh calls from
// App.tsx useEffect and HttpClient 401 handler racing each other.
let refreshPromise: Promise<void> | null = null

/**
 * Cross-tab refresh serialization. The refresh cookie is single-use (rotation);
 * two tabs presenting the same cookie concurrently read as token reuse on the
 * server, which revokes the whole session and force-logs-out everywhere. Each
 * tab's single-flight guard cannot help (separate module state), so the actual
 * refresh runs under a Web Locks mutex. When the second tab finally acquires
 * the lock, the browser's shared cookie jar already holds the rotated cookie
 * and its refresh succeeds normally.
 */
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null
  if (!locks) return fn()
  return locks.request('tmarks-auth-refresh', fn)
}

/** Best-effort JWT exp check (base64url payload only — no signature claim). */
function isAccessTokenExpired(token: string | null): boolean {
  if (!token) return true
  try {
    const b64 = (token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(b64)) as { exp?: number }
    if (typeof payload.exp !== 'number') return false
    return payload.exp * 1000 <= Date.now() + 5000
  } catch {
    // Unparseable token: treat as expired. The caller falls back to the
    // HttpOnly-cookie refresh, which either mints a fresh token or fails
    // closed — strictly safer than sending a mangled bearer.
    return true
  }
}

interface AuthState {
  user: AuthUserDTO | null
  accessToken: string | null
  isAuthenticated: boolean
  isLoading: boolean

  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>
  logout: (revokeAll?: boolean) => Promise<void>
  refreshAccessToken: () => Promise<void>
  setUser: (user: AuthUserDTO) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,

      login: async (username, password, rememberMe = false) => {
        set({ isLoading: true })
        try {
          // The refresh token arrives as an HttpOnly cookie (tmarks_rt) and is
          // never stored in JavaScript memory, so an XSS cannot exfiltrate it.
          const data = await authService.login({ username, password, remember_me: rememberMe })
          set({
            user: data.user,
            accessToken: data.access_token,
            isAuthenticated: true,
            isLoading: false,
          })
        } catch (error) {
          set({ isLoading: false })
          throw error
        }
      },

      logout: async (revokeAll = false) => {
        const { accessToken } = get()
        // Ensure a valid bearer so the server can revoke the session and
        // clear the HttpOnly cookie; without it the cookie would survive
        // this logout and silently re-authenticate on the next reload.
        // Refresh for a missing OR expired token: an expired bearer 401s
        // in the auth middleware before the handler runs, /auth/* never
        // triggers the client refresh path, and "logout everywhere" would
        // silently become a no-op.
        // The pre-refresh is BEST-EFFORT: on failure we still attempt the
        // logout call with the stale bearer. Skipping it (the old shape)
        // left a live HttpOnly cookie behind on transient refresh errors —
        // the user appears logged out until the next reload quietly signs
        // them back in.
        if (!accessToken || isAccessTokenExpired(accessToken)) {
          try {
            await get().refreshAccessToken()
          } catch (error) {
            if (error instanceof Error && !error.message.includes('Token expired')) {
              logger.error('Logout pre-refresh failed:', error)
            }
          }
        }
        try {
          await authService.logout({ revoke_all: revokeAll })
        } catch (error) {
          if (error instanceof Error && !error.message.includes('Token expired')) {
            logger.error('Logout error:', error)
          }
        }
        set({ user: null, accessToken: null, isAuthenticated: false })
        clearLocalAuthArtifacts()
      },

      refreshAccessToken: async () => {
        // Single-flight: if a refresh is already in progress, reuse it
        if (refreshPromise) return refreshPromise
        refreshPromise = withRefreshLock(async () => {
          try {
            const data = await authService.refreshToken({})
            set({
              user: data.user,
              accessToken: data.access_token,
              isAuthenticated: true,
            })
          } catch (error) {
            get().clearAuth()
            throw error
          } finally {
            refreshPromise = null
          }
        })
        return refreshPromise
      },

      setUser: (user) => set({ user }),

      clearAuth: () => {
        set({ user: null, accessToken: null, isAuthenticated: false, isLoading: false })
        clearLocalAuthArtifacts()
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      // Persist only the profile for UI convenience. The access token stays
      // in memory and the refresh token lives in an HttpOnly cookie, so no
      // credential survives a page reload in JavaScript-readable storage.
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      // Keep the in-memory access token rather than clobbering it with
      // undefined on rehydrate.
      merge: (persisted, current) => ({ ...current, ...(persisted as object) }),
    },
  ),
)

// Cross-tab session sync. The persisted slice only carries the profile +
// isAuthenticated flag (tokens never enter localStorage), so a storage event
// from another tab's login/logout is a session-level signal. Without this,
// logged-out tabs kept firing authenticated requests with stale tokens —
// feeding the very concurrent-refresh scenario the lock above prevents.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== 'auth-storage' || event.newValue === null) return
    try {
      const persisted = JSON.parse(event.newValue) as {
        state?: { user: AuthUserDTO | null; isAuthenticated?: boolean }
      }
      const authenticated = Boolean(persisted.state?.isAuthenticated)
      const state = useAuthStore.getState()
      if (authenticated === state.isAuthenticated) return
      if (authenticated) {
        useAuthStore.setState({ user: persisted.state?.user ?? null, isAuthenticated: true })
        // This tab has no access token in memory; mint one via the (shared)
        // refresh cookie. Refresh runs under the cross-tab lock.
        void state.refreshAccessToken()
      } else {
        state.clearAuth()
      }
    } catch {
      // Malformed storage payload — ignore; local state stays authoritative.
    }
  })
}