import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../lib/env'
import { maybePruneAuditLogs } from '../lib/audit/retention'

/** Log every request (method/url/status/duration/ip) and tag it with X-Request-ID. */
export const requestLogger: MiddlewareHandler<AppEnv> = async (c, next) => {
  const start = Date.now()
  const requestId = getRequestId(c.req.raw)
  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  const userAgent = c.req.header('User-Agent') || 'unknown'
  const sanitizedUrl = sanitizeLogUrl(c.req.url)

  try {
    await next()
    const duration = Date.now() - start
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        request_id: requestId,
        method: c.req.method,
        url: sanitizedUrl,
        status: c.res.status,
        duration_ms: duration,
        ip,
        userAgent: userAgent.substring(0, 100),
      })
    )
    appendRequestId(c, requestId)
    // Attached to the invocation's lifetime (R5-7): without waitUntil the
    // isolate can settle before the 1% retention sweep ever runs.
    maybePruneAuditLogs(c.env.DB, (promise) => c.executionCtx.waitUntil(promise))
  } catch (error) {
    const duration = Date.now() - start
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        request_id: requestId,
        method: c.req.method,
        url: sanitizedUrl,
        error: error instanceof SyntaxError ? 'Invalid JSON body' : error instanceof Error ? error.message : 'Unknown error',
        duration_ms: duration,
        ip,
        userAgent: userAgent.substring(0, 100),
      })
    )
    throw error
  }
}

function getRequestId(request: Request): string {
  const incoming = request.headers.get('X-Request-ID') || request.headers.get('CF-Ray')
  return incoming?.trim() || crypto.randomUUID()
}

// User-content parameters that must never reach persistent logs: search
// keywords and full bookmark URLs (URLs frequently embed tokens / reset links).
const REDACTED_PARAMS = ['sig', 'token', 'api_key', 'key', 'u', 'user', 'b', 'q', 'keyword', 'url']

export function sanitizeLogUrl(rawUrl: string): string {
  const logUrl = new URL(rawUrl)

  for (const param of REDACTED_PARAMS) {
    if (logUrl.searchParams.has(param)) {
      logUrl.searchParams.set(param, '***')
    }
  }

  // The public-share slug is the ONLY secret guarding an unauthenticated
  // endpoint (routes/public-share.ts) — it lives in the pathname, which the
  // query redaction above cannot touch.
  logUrl.pathname = logUrl.pathname.replace(/^(\/api\/public\/share\/).+$/, '$1***')

  return logUrl.toString()
}

function appendRequestId(c: { res: Response }, requestId: string): void {
  const headers = new Headers(c.res.headers)
  headers.set('X-Request-ID', requestId)
  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  })
}
