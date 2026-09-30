import { isPublicHttpUrl } from './public-url'

/**
 * Redirect-guarded outbound fetch for user-supplied URLs.
 *
 * `redirect: 'follow'` would hand control to the runtime: a public site can 30x
 * into 127.0.0.1 / 169.254.169.254 and the code would never see the final URL.
 * Following manually keeps every hop in front of the SSRF guard — including
 * the redirect target, which is where the attacker actually points you.
 *
 * Returns null for blocked URLs, network errors and overlong redirect chains
 * (callers treat that as "no data"); a single shared AbortSignal bounds the
 * TOTAL time across hops, matching the old one-shot timeout semantics.
 */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface ExternalFetchOptions {
  headers?: Record<string, string>
  timeoutMs: number
  maxRedirects?: number
}

export async function fetchExternalResource(
  rawUrl: string,
  options: ExternalFetchOptions
): Promise<{ response: Response; url: string } | null> {
  const maxRedirects = options.maxRedirects ?? 5
  const signal = AbortSignal.timeout(options.timeoutMs)

  let current = rawUrl
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isPublicHttpUrl(current)) return null

    let response: Response
    try {
      response = await fetch(current, {
        headers: options.headers,
        redirect: 'manual',
        signal,
      })
    } catch {
      return null
    }

    // workerd/undici expose the real 3xx (unlike browsers, which give an
    // opaque redirect); a zero-status response means we cannot inspect the
    // Location header — fail closed rather than follow blindly.
    if (!REDIRECT_STATUSES.has(response.status)) return { response, url: current }

    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)
    if (hop === maxRedirects || !location) return null

    try {
      current = new URL(location, current).href
    } catch {
      return null
    }
  }
  return null
}
