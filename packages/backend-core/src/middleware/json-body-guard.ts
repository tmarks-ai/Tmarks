import type { MiddlewareHandler } from 'hono'
import type { AppEnv } from '../lib/env'
import { badRequest, payloadTooLarge } from '../lib/response'

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024
const AUTH_MAX_BODY_BYTES = 64 * 1024
const LARGE_WRITE_MAX_BODY_BYTES = 8 * 1024 * 1024

function maxBodyBytes(path: string): number {
  if (path.startsWith('/api/v1/auth/')) return AUTH_MAX_BODY_BYTES
  if (path.includes('/snapshots') || path.includes('/bulk') || path.endsWith('/sync/push')) return LARGE_WRITE_MAX_BODY_BYTES
  return DEFAULT_MAX_BODY_BYTES
}

async function readBodyWithinLimit(request: Request, limit: number): Promise<{ text: string } | { tooLarge: true }> {
  const declaredLength = Number(request.headers.get('content-length') || '0')
  if (Number.isFinite(declaredLength) && declaredLength > limit) return { tooLarge: true }

  const body = request.body
  if (!body) return { text: '' }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      received += value.byteLength
      if (received > limit) {
        await reader.cancel().catch(() => undefined)
        return { tooLarge: true }
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(bytes) }
}

/**
 * Malformed JSON bodies must answer 400, not 500, and oversized bodies must be
 * rejected before route handlers or rate-limit work can amplify their cost.
 * The guard reads a clone with a byte budget; the original request stream stays
 * available to the handler's own `c.req.json()` call.
 *
 * R5-4: the guard used to read (and JSON.parse) up to 8MB per write request
 * BEFORE any authentication — an unauthenticated flood of chunked bodies
 * (which bypass the content-length precheck) forced a full stream read plus a
 * parse per request, unlimited. Every write outside /api/v1/auth/* requires
 * credentials, so a request carrying none can only ever be 401'd by the auth
 * middleware — the guard now leaves its body untouched on that path. The auth
 * plane stays guarded: it is the legitimate anonymous write surface (64KB).
 *
 * R5-5 (accepted tradeoff): the clone means the body is read and parsed twice
 * (guard + handler, ~2x CPU on ≤8MB writes). The alternative — dropping the
 * guard's parse — would re-expose 500s on handlers that wrap `c.req.json()` in
 * their own catch, which is exactly what the guard exists to prevent; per-
 * handler rewrites to consume a stashed value are the only way out and are not
 * worth the churn for a single-user self-hosted product.
 */
export const jsonBodyGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method
  if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return next()

  const path = new URL(c.req.url).pathname
  if (!path.startsWith('/api/v1/auth/') && !requestHasCredentials(c.req.raw)) return next()

  const result = await readBodyWithinLimit(c.req.raw.clone(), maxBodyBytes(path))
  if ('tooLarge' in result) return payloadTooLarge('Request body is too large')
  if (result.text.trim() === '') return next()
  try {
    JSON.parse(result.text)
  } catch {
    return badRequest('Invalid JSON body')
  }
  return next()
}

function requestHasCredentials(request: Request): boolean {
  const authorization = request.headers.get('Authorization')
  if (authorization && authorization.trim() !== '') return true
  return Boolean(request.headers.get('X-API-Key'))
}
