import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchExternalResource } from '../src/lib/net/external-fetch'

/**
 * SSRF redirect regressions: the pre-fix code used redirect:'follow', so a
 * public site could 30x into an internal address with no re-validation. These
 * tests stub global fetch and assert the guarded client never ISSUES the
 * request for an internal hop, follows legitimate chains, and fails closed on
 * overlong/looping chains.
 */

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

function stubFetch(handler: (url: string) => Response | null) {
  const calls: FetchCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      const response = handler(url)
      if (response) return response
      return new Response('not found', { status: 404 })
    })
  )
  return calls
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchExternalResource', () => {
  it('returns the final response for a direct public URL', async () => {
    const calls = stubFetch(() => new Response('<html>ok</html>', { headers: { 'content-type': 'text/html' } }))
    const result = await fetchExternalResource('https://example.com/page', { timeoutMs: 1000 })

    expect(result?.response.status).toBe(200)
    expect(result?.url).toBe('https://example.com/page')
    expect(calls.map((c) => c.url)).toEqual(['https://example.com/page'])
    expect(calls[0]!.init?.redirect).toBe('manual')
  })

  it('follows a legitimate public redirect chain and reports the final URL', async () => {
    const calls = stubFetch((url) => {
      if (url === 'https://example.com/a') return redirect('https://cdn.example.com/b')
      if (url === 'https://cdn.example.com/b') return redirect('/c')
      return new Response('final', { status: 200 })
    })
    const result = await fetchExternalResource('https://example.com/a', { timeoutMs: 1000 })

    // Relative Location resolved against the CURRENT hop, not the start URL.
    expect(calls.map((c) => c.url)).toEqual([
      'https://example.com/a',
      'https://cdn.example.com/b',
      'https://cdn.example.com/c',
    ])
    expect(result?.url).toBe('https://cdn.example.com/c')
  })

  it('never issues the request for an internal IP literal target', async () => {
    const calls = stubFetch(() => new Response('should not be reached', { status: 200 }))
    const result = await fetchExternalResource('http://169.254.169.254/latest/meta-data/', { timeoutMs: 1000 })

    expect(result).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('blocks a public site redirecting into a private address (the SSRF oracle)', async () => {
    const calls = stubFetch((url) => {
      if (url === 'https://attacker.example/og') return redirect('http://127.0.0.1:8080/admin')
      return new Response('ok', { status: 200 })
    })
    const result = await fetchExternalResource('https://attacker.example/og', { timeoutMs: 1000 })

    expect(result).toBeNull()
    // The internal hop was never fetched — blocked before the fetch call.
    expect(calls.map((c) => c.url)).toEqual(['https://attacker.example/og'])
  })

  it('blocks redirects into cloud metadata and IPv6 loopback', async () => {
    for (const [start, internal] of [
      ['https://a.example/x', 'http://169.254.169.254/latest/meta-data/'],
      ['https://b.example/x', 'http://[::1]:9000/'],
    ] as const) {
      const calls = stubFetch((url) => (url === start ? redirect(internal) : new Response('ok')))
      expect(await fetchExternalResource(start, { timeoutMs: 1000 })).toBeNull()
      expect(calls.map((c) => c.url)).toEqual([start])
    }
  })

  it('fails closed when the redirect chain exceeds the hop budget', async () => {
    const calls = stubFetch(() => redirect('https://example.com/loop'))
    const result = await fetchExternalResource('https://example.com/start', {
      timeoutMs: 1000,
      maxRedirects: 3,
    })

    expect(result).toBeNull()
    // 1 initial request + 3 followed redirects = 4 fetches, then stop.
    expect(calls).toHaveLength(4)
  })

  it('returns null for network errors and 3xx without a Location header', async () => {
    stubFetch(() => {
      throw new TypeError('fetch failed')
    })
    expect(await fetchExternalResource('https://down.example/', { timeoutMs: 1000 })).toBeNull()

    stubFetch(() => new Response(null, { status: 302 }))
    expect(await fetchExternalResource('https://noloc.example/', { timeoutMs: 1000 })).toBeNull()
  })
})
