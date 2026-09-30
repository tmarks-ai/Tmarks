import type { Context } from 'hono'
import type { AppEnv } from '../../lib/env'
import { badRequest, internalError, success, tooManyRequests } from '../../lib/response'
import { isValidUrl, sanitizeString } from '../../lib/validation'
import { parseHeadMetadata } from '../../lib/bookmarks/url-metadata'
import { fetchExternalResource } from '../../lib/net/external-fetch'
import { consumeUnauthenticatedRateLimit } from '../../lib/api-key/rate-limit-binding'
import type { RateLimitConfig } from '../../lib/api-key/rate-limiter-types'

/**
 * GET /bookmarks/url-metadata?url=... — fetch a page server-side and extract
 * title/description/favicon/og:image for the bookmark form.
 *
 * Privacy: the fetch runs on the Worker, never through a third-party favicon
 * service, so saved domains are not leaked to Google et al.
 * Cost: 0 D1 rows — one outbound fetch + bounded CPU; the JWT-plane rate limit
 * (240 req/min per user) already bounds abuse from an authenticated account.
 * SSRF: every URL and every redirect hop passes the shared public-host guard
 * (lib/net/public-url.ts) — a blocked or unreachable host looks identical to
 * the caller, so the endpoint offers no internal-network oracle. A dedicated
 * per-user bucket (20/min on the D1 fallback; the native binding's configured
 * rate governs when present) shrinks the probe budget below the JWT plane's.
 */

// Read at most this much of the HTML: <head> metadata lives at the front, and
// the cap keeps a hostile multi-megabyte page from burning Worker memory.
const MAX_HTML_BYTES = 512 * 1024
const FETCH_TIMEOUT_MS = 8000
const META_LIMITS: RateLimitConfig = { per_minute: 20, per_hour: 240, per_day: 2400 }

export async function urlMetadataHandler(c: Context<AppEnv>): Promise<Response> {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')

  const rate = await consumeUnauthenticatedRateLimit(c.env, `url-meta:${auth.user_id}`, META_LIMITS)
  if (!rate.allowed) {
    return tooManyRequests(
      { code: 'RATE_LIMITED', message: 'Too many requests' },
      { 'Retry-After': String(rate.retryAfter || 60) }
    )
  }

  try {
    const rawUrl = new URL(c.req.url).searchParams.get('url')
    const targetUrl = rawUrl ? sanitizeString(rawUrl, 2000) : ''
    if (!targetUrl || !isValidUrl(targetUrl)) {
      return badRequest('A valid http(s) url is required')
    }

    const metadata = await fetchPageMetadata(targetUrl)
    return success({ metadata })
  } catch (error) {
    console.error('URL metadata error:', error)
    return internalError('Failed to load page metadata')
  }
}

async function fetchPageMetadata(targetUrl: string) {
  const fetched = await fetchExternalResource(targetUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; TMarksBookmarkBot/1.0)',
    },
    timeoutMs: FETCH_TIMEOUT_MS,
  })
  if (!fetched) {
    // Blocked host / unreachable / timeout: still offer the conventional
    // favicon path — most sites serve /favicon.ico even when nothing else is
    // reachable.
    return { title: null, description: null, favicon: fallbackFavicon(targetUrl), cover_image: null }
  }
  const { response, url: finalUrl } = fetched

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('text/html') && contentType !== '') {
    // Non-HTML resource (image/pdf/...): nothing to parse.
    return { title: null, description: null, favicon: fallbackFavicon(finalUrl), cover_image: null }
  }

  const html = await readCapped(response)
  const parsed = parseHeadMetadata(html, finalUrl)

  return {
    title: parsed.title,
    description: parsed.description,
    favicon: parsed.favicon ?? fallbackFavicon(finalUrl),
    cover_image: parsed.cover_image,
  }
}

/** Stream-read the body up to the cap, then cancel — a full .text() would let a hostile page size the memory. */
async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''

  const decoder = new TextDecoder()
  let text = ''
  let received = 0
  while (received < MAX_HTML_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    text += decoder.decode(value, { stream: true })
    if (received >= MAX_HTML_BYTES) {
      await reader.cancel().catch(() => undefined)
      break
    }
  }
  return text
}

function fallbackFavicon(targetUrl: string): string | null {
  try {
    return new URL('/favicon.ico', targetUrl).href
  } catch {
    return null
  }
}
