import type { Env } from '../env'
import { getEnvironment } from '../config'

const REFRESH_COOKIE_NAME = 'tmarks_rt'

/**
 * The web app's refresh token travels only in an HttpOnly cookie, never in
 * JavaScript-readable storage. rememberMe=false issues a session cookie (no
 * Max-Age); rememberMe=true persists it for the token's lifetime.
 */
export function buildRefreshCookie(env: Env, token: string, rememberMe: boolean, maxAgeSeconds?: number): string {
  const parts = [
    `${REFRESH_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (getEnvironment(env) === 'production') {
    parts.push('Secure')
  }
  if (rememberMe && maxAgeSeconds) {
    parts.push(`Max-Age=${maxAgeSeconds}`)
  }
  return parts.join('; ')
}

export function buildRefreshCookieCleared(env: Env): string {
  const parts = [`${REFRESH_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (getEnvironment(env) === 'production') {
    parts.push('Secure')
  }
  return parts.join('; ')
}

/** Read the refresh token from the cookie jar or (fallback) the request body. */
export function readRefreshToken(request: Request, body: { refresh_token?: string } | null): string | null {
  const cookieHeader = request.headers.get('Cookie')
  if (cookieHeader) {
    for (const chunk of cookieHeader.split(';')) {
      const [rawName, ...rest] = chunk.trim().split('=')
      if (rawName === REFRESH_COOKIE_NAME) {
        const value = rest.join('=').trim()
        if (value) return value
      }
    }
  }
  return body?.refresh_token?.trim() || null
}

export function appendSetCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', cookie)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}