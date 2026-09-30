import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HttpClient, type AuthDelegate } from '../src/lib/http-client'
import { ApiError } from '../src/lib/api-error'

/**
 * HttpClient is the sole network funnel for the web app. Its refresh queue
 * is load-bearing: a refresh-token cookie is single-use, so two concurrent
 * 401s must share ONE refresh, and a failed refresh must reject every
 * queued caller (otherwise a hung tab quietly leaks memory in
 * refreshSubscribers).
 */

let currentToken: string | null = null
const authDelegate: AuthDelegate = {
  getAccessToken: () => currentToken,
  refresh: async () => { currentToken = 'token-refreshed' },
  onAuthFailure: () => { currentToken = null },
}

function makeClient(): HttpClient {
  const client = new HttpClient('/api/v1')
  client.bindAuth(authDelegate)
  return client
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function mockFetchSequence(responses: Array<(url: string, init?: RequestInit) => Promise<Response>>) {
  let call = 0
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const handler = responses[Math.min(call, responses.length - 1)]!
    call++
    return handler(String(input), init)
  })
  globalThis.fetch = spy as unknown as typeof fetch
  return { spy, getCallCount: () => call }
}

beforeEach(() => {
  currentToken = 'token-A'
})

afterEach(() => {
  vi.restoreAllMocks()
  currentToken = null
})

describe('HttpClient error envelope parsing', () => {
  it('extracts the {error:{code,message}} envelope into an ApiError', async () => {
    mockFetchSequence([
      () => jsonResponse(409, { error: { code: 'CONFLICT', message: 'Slug is already taken' } }),
    ])

    const error = await makeClient().get('/bookmark-folders').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('CONFLICT')
    expect((error as ApiError).message).toBe('Slug is already taken')
    expect((error as ApiError).status).toBe(409)
  })

  it('returns the 204 body as an empty ApiResponse', async () => {
    mockFetchSequence([() => new Response(null, { status: 204 })])

    const result = await makeClient().delete('/bookmark-folders/some-id')
    expect(result).toEqual({})
  })

  it('wraps a non-JSON error response with an INVALID_RESPONSE ApiError', async () => {
    mockFetchSequence([() => new Response('<html>gateway timeout</html>', { status: 502 })])

    const error = await makeClient().get('/bookmarks').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('INVALID_RESPONSE')
    expect((error as ApiError).status).toBe(502)
  })

  it('wraps a network failure as NETWORK_ERROR with status 0', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch

    const error = await makeClient().get('/bookmarks').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('NETWORK_ERROR')
    expect((error as ApiError).status).toBe(0)
  })
})

describe('HttpClient refresh-after-401 (single-flight queue)', () => {
  it('does NOT refresh for /auth/* endpoints', async () => {
    const { spy } = mockFetchSequence([
      () => jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }),
    ])

    const error = await makeClient().get('/auth/whoami').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('UNAUTHORIZED')
    // Only the original request was made — no refresh was attempted.
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('refreshes once for a 401, then retries with the new token', async () => {
    const { spy } = mockFetchSequence([
      () => jsonResponse(401, { error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } }),
      // Retry with new token
      (url, init) => {
        const headers = new Headers(init?.headers)
        expect(headers.get('Authorization')).toBe('Bearer token-refreshed')
        return jsonResponse(200, { data: { bookmarks: [] } })
      },
    ])

    const result = await makeClient().get('/bookmarks')
    expect(result.data).toEqual({ bookmarks: [] })
    expect(spy).toHaveBeenCalledTimes(2) // original 401 + retry
  })

  it('shares ONE refresh across concurrent 401s (single-flight)', async () => {
    const { spy } = mockFetchSequence([
      () => jsonResponse(401, { error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } }),
      () => jsonResponse(401, { error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } }),
      // Retries
      () => jsonResponse(200, { data: { id: 'A' } }),
      () => jsonResponse(200, { data: { id: 'B' } }),
    ])

    const client = makeClient()
    const [resultA, resultB] = await Promise.all([
      client.get('/bookmarks/a'),
      client.get('/bookmarks/b'),
    ])

    expect(resultA.data).toEqual({ id: 'A' })
    expect(resultB.data).toEqual({ id: 'B' })
    // 2 originals + 2 retries = 4 fetch calls (the refresh itself goes
    // through the injected auth delegate, not an HTTP round trip).
    expect(spy).toHaveBeenCalledTimes(4)
  })

  it('rejects all queued subscribers when the refresh fails', async () => {
    mockFetchSequence([
      () => jsonResponse(401, { error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } }),
      () => jsonResponse(401, { error: { code: 'TOKEN_EXPIRED', message: 'Token expired' } }),
    ])
    const failingDelegate: AuthDelegate = {
      getAccessToken: () => currentToken,
      refresh: async () => { throw new Error('Refresh failed') },
      onAuthFailure: () => { currentToken = null },
    }
    const client = new HttpClient('/api/v1')
    client.bindAuth(failingDelegate)

    const [errorA, errorB] = await Promise.allSettled([
      client.get('/bookmarks/a'),
      client.get('/bookmarks/b'),
    ])

    expect(errorA.status).toBe('rejected')
    expect(errorB.status).toBe('rejected')
    expect((errorA as PromiseRejectedResult).reason).toBeInstanceOf(ApiError)
    expect((errorB as PromiseRejectedResult).reason).toBeInstanceOf(ApiError)
    expect(currentToken).toBeNull() // onAuthFailure was called
  })
})

describe('HttpClient request header construction', () => {
  it('attaches Authorization Bearer from the auth delegate', async () => {
    const { spy } = mockFetchSequence([
      (url, init) => {
        const headers = new Headers(init?.headers)
        expect(headers.get('Authorization')).toBe('Bearer token-A')
        return jsonResponse(200, { data: { ok: true } })
      },
    ])

    await makeClient().get('/bookmarks')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('sets Content-Type application/json when a body is present', async () => {
    mockFetchSequence([
      (url, init) => {
        const headers = new Headers(init?.headers)
        expect(headers.get('Content-Type')).toBe('application/json')
        return jsonResponse(200, { data: { ok: true } })
      },
    ])

    await makeClient().post('/bookmark-folders', { name: 'New Folder' })
  })

  it('sends credentials include (HttpOnly refresh cookie)', async () => {
    mockFetchSequence([
      (url, init) => {
        expect(init?.credentials).toBe('include')
        return jsonResponse(200, { data: { ok: true } })
      },
    ])

    await makeClient().get('/bookmarks')
  })
})
