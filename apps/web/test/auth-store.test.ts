import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * AuthStore behavior tests: single-flight refresh, persistence partialize
 * (tokens never enter localStorage), and the auth delegate contract that
 * HttpClient depends on.
 *
 * These exercise the real zustand store, not a mock — the single-flight
 * guard (module-level `refreshPromise`) and the persist middleware's
 * partialize are both load-bearing for concurrent 401 handling.
 */

describe('authStore behavior', () => {
  // Lazy import to get a fresh module instance per test file execution
  let authStore: typeof import('../src/stores/authStore')['useAuthStore']

  beforeEach(async () => {
    localStorage.clear()
    const mod = await import('../src/stores/authStore')
    authStore = mod.useAuthStore
    authStore.setState({ user: null, accessToken: null, isAuthenticated: false, isLoading: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('persists only the user profile and isAuthenticated flag — never the access token', () => {
    authStore.setState({
      user: { id: 'u-1', username: 'test', email: null, created_at: '2026-01-01', updated_at: '2026-01-01' },
      accessToken: 'secret-jwt-token',
      isAuthenticated: true,
      isLoading: false,
    })

    const persisted = JSON.parse(localStorage.getItem('auth-storage') ?? '{}')
    // The persisted state must NOT contain the token
    expect(persisted.state.accessToken).toBeUndefined()
    expect(persisted.state.user).toBeDefined()
    expect(persisted.state.isAuthenticated).toBe(true)
  })

  it('refreshAccessToken is single-flight: concurrent calls share one promise', async () => {
    let refreshCount = 0
    // Mock the auth service's refreshToken to count invocations
    const { authService } = await import('../src/services/auth')
    const spy = vi.spyOn(authService, 'refreshToken').mockImplementation(async () => {
      refreshCount++
      await new Promise((r) => setTimeout(r, 50))
      return { user: null, access_token: 'new-token' } as never
    })

    const [promise1, promise2, promise3] = [
      authStore.getState().refreshAccessToken(),
      authStore.getState().refreshAccessToken(),
      authStore.getState().refreshAccessToken(),
    ]

    await Promise.all([promise1, promise2, promise3])

    // All three calls shared ONE actual refresh
    expect(refreshCount).toBe(1)
    expect(authStore.getState().accessToken).toBe('new-token')
  })

  it('refreshAccessToken clears auth on failure', async () => {
    const { authService } = await import('../src/services/auth')
    vi.spyOn(authService, 'refreshToken').mockRejectedValue(new Error('Refresh failed'))

    authStore.setState({ user: { id: 'u-1', username: 'test', email: null, created_at: '', updated_at: '' }, accessToken: 'old', isAuthenticated: true })

    await expect(authStore.getState().refreshAccessToken()).rejects.toThrow('Refresh failed')

    // Auth was cleared
    expect(authStore.getState().accessToken).toBeNull()
    expect(authStore.getState().isAuthenticated).toBe(false)
  })

  it('clearAuth resets all auth state', () => {
    authStore.setState({
      user: { id: 'u-1', username: 'test', email: null, created_at: '', updated_at: '' },
      accessToken: 'some-token',
      isAuthenticated: true,
      isLoading: false,
    })

    authStore.getState().clearAuth()

    expect(authStore.getState().user).toBeNull()
    expect(authStore.getState().accessToken).toBeNull()
    expect(authStore.getState().isAuthenticated).toBe(false)
    expect(authStore.getState().isLoading).toBe(false)
  })

  it('login stores the user and token from the server response', async () => {
    const mockUser = { id: 'u-1', username: 'test', email: 't@e.com', created_at: '2026-01-01', updated_at: '2026-01-01' }
    const { authService } = await import('../src/services/auth')
    vi.spyOn(authService, 'login').mockResolvedValue({
      user: mockUser,
      access_token: 'fresh-jwt',
    } as never)

    await authStore.getState().login('test', 'password')

    expect(authStore.getState().user).toEqual(mockUser)
    expect(authStore.getState().accessToken).toBe('fresh-jwt')
    expect(authStore.getState().isAuthenticated).toBe(true)
    expect(authStore.getState().isLoading).toBe(false)
  })

  it('login resets isLoading on failure and re-throws', async () => {
    const { authService } = await import('../src/services/auth')
    vi.spyOn(authService, 'login').mockRejectedValue(new Error('Bad credentials'))

    await expect(authStore.getState().login('test', 'wrong')).rejects.toThrow('Bad credentials')
    expect(authStore.getState().isLoading).toBe(false)
    expect(authStore.getState().isAuthenticated).toBe(false)
  })
})
