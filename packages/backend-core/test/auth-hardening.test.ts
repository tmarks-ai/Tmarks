import { describe, expect, it } from 'vitest'
import {
  buildRefreshCookie,
  buildRefreshCookieCleared,
  consumeRateLimit,
  escapeLike,
  generateJWT,
  generateSlug,
  getPbkdf2Iterations,
  isValidHexColor,
  readRefreshToken,
  sanitizeColor,
  verifyJWT,
} from '@tmarks/backend-core'
import type { Env } from '../src/lib/env'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnvironmentIssue } from '../src/lib/config'

const SECRET = 'x'.repeat(32)

function b64url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlBytes(value: ArrayBuffer): string {
  let binary = ''
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte)
  return b64url(binary)
}

async function signHs256(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return b64urlBytes(signature)
}

describe('JWT hardening', () => {
  it('verifies a valid session-bound token', async () => {
    const token = await generateJWT({ sub: 'u1', session_id: 's1' }, SECRET, '1h')
    const payload = await verifyJWT(token, SECRET)
    expect(payload.sub).toBe('u1')
    expect(payload.session_id).toBe('s1')
  })

  it('rejects tokens signed with a non-HS256 algorithm', async () => {
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const payload = b64url(JSON.stringify({ sub: 'u1', session_id: 's1', iat: 1, exp: 4102444800 }))
    const token = `${header}.${payload}.garbage`
    await expect(verifyJWT(token, SECRET)).rejects.toThrow('Unsupported signing algorithm')
  })

  it('rejects a correctly signed token without a session binding', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = b64url(JSON.stringify({ sub: 'u1', iat: 1, exp: 4102444800 }))
    const signature = await signHs256(`${header}.${payload}`, SECRET)
    const token = `${header}.${payload}.${signature}`
    await expect(verifyJWT(token, SECRET)).rejects.toThrow('session binding')
  })

  it('rejects an expired token', async () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = b64url(JSON.stringify({ sub: 'u1', session_id: 's1', iat: 1, exp: 1 }))
    const signature = await signHs256(`${header}.${payload}`, SECRET)
    await expect(verifyJWT(`${header}.${payload}.${signature}`, SECRET)).rejects.toThrow('Token expired')
  })
})

describe('generateSlug entropy', () => {
  it('produces 16-char base62 slugs with no bias-visible repeats', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i += 1) {
      const slug = generateSlug()
      expect(slug).toMatch(/^[0-9A-Za-z]{16}$/)
      seen.add(slug)
    }
    expect(seen.size).toBe(50)
  })
})

describe('LIKE escaping', () => {
  it('escapes wildcard and escape characters', () => {
    expect(escapeLike('100%_done\\x')).toBe('100\\%\\_done\\\\x')
    expect(escapeLike('plain')).toBe('plain')
  })
})

describe('color validation', () => {
  it('accepts 3-8 digit hex colors and rejects everything else', () => {
    expect(sanitizeColor('#3b82f6')).toBe('#3b82f6')
    expect(sanitizeColor('#Ff0')).toBe('#Ff0')
    expect(sanitizeColor('#12345678')).toBe('#12345678')
    expect(sanitizeColor('red')).toBeNull()
    expect(sanitizeColor('#gggggg')).toBeNull()
    expect(sanitizeColor('javascript:alert(1)')).toBeNull()
    expect(sanitizeColor(null)).toBeNull()
    expect(isValidHexColor('#3b82f6')).toBe(true)
    expect(isValidHexColor('blue')).toBe(false)
  })
})

describe('refresh cookie', () => {
  const prodEnv = { ENVIRONMENT: 'production' } as Env
  const devEnv = { ENVIRONMENT: 'development' } as Env

  it('sets HttpOnly/SameSite/Path and honors rememberMe and environment', () => {
    const session = buildRefreshCookie(devEnv, 'token', false, 3600)
    expect(session).toContain('tmarks_rt=token')
    expect(session).toContain('HttpOnly')
    expect(session).toContain('SameSite=Lax')
    expect(session).toContain('Path=/')
    expect(session).not.toContain('Max-Age')
    expect(session).not.toContain('Secure')

    const persistent = buildRefreshCookie(prodEnv, 'token', true, 3600)
    expect(persistent).toContain('Max-Age=3600')
    expect(persistent).toContain('Secure')
  })

  it('clears the cookie with Max-Age=0', () => {
    const cleared = buildRefreshCookieCleared(prodEnv)
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('Secure')
  })

  it('reads the token from the cookie jar or the body fallback', () => {
    const request = new Request('https://example.com', { headers: { Cookie: 'a=1; tmarks_rt=abc123; b=2' } })
    expect(readRefreshToken(request, null)).toBe('abc123')
    const bodyOnly = new Request('https://example.com')
    expect(readRefreshToken(bodyOnly, { refresh_token: 'body-token' })).toBe('body-token')
    expect(readRefreshToken(bodyOnly, null)).toBeNull()
  })
})

describe('PBKDF2 iteration config', () => {
  // Default is 100k: the Workers runtime hard-rejects anything above 100000
  // (NotSupportedError), so the old 600k OWASP default 500'd all auth on deploy.
  it('clamps to the safe range and defaults to the Workers-capped 100k', () => {
    expect(getPbkdf2Iterations({} as Env)).toBe(100_000)
    expect(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '100000' } as Env)).toBe(100_000)
    expect(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '999999' } as Env)).toBe(999_999)
    expect(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '10' } as Env)).toBe(100_000)
    expect(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '3000000' } as Env)).toBe(100_000)
    expect(getPbkdf2Iterations({ PBKDF2_ITERATIONS: 'not-a-number' } as Env)).toBe(100_000)
  })
})

describe('rate limiter fail-closed', () => {
  it('denies when the backing store throws and onError is deny', async () => {
    const brokenDb = {
      prepare: () => {
        throw new Error('D1 unavailable')
      },
    } as unknown as D1Database
    const result = await consumeRateLimit('login:someone', brokenDb, { per_minute: 30, per_hour: 600, per_day: 5000 }, { onError: 'deny' })
    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it('still fails open by default for API-key fallback use', async () => {
    const brokenDb = {
      prepare: () => {
        throw new Error('D1 unavailable')
      },
    } as unknown as D1Database
    const result = await consumeRateLimit('key_1', brokenDb, { per_minute: 100, per_hour: 1000, per_day: 5000 })
    expect(result.allowed).toBe(true)
  })
})
describe('JWT secret startup gate', () => {
  // Regression: the gate only checked length, and the placeholder shipped in
  // .dev.vars.example / DEPLOY.md is 37 characters. A self-hoster who copied
  // the example and skipped the edit step got a worker running on a secret
  // published in this repository.
  it('rejects the placeholder from .dev.vars.example', () => {
    const example = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../apps/worker/.dev.vars.example'),
      'utf8'
    )
    const secret = example.match(/JWT_SECRET="([^"]+)"/)?.[1]
    expect(secret, 'example must define JWT_SECRET').toBeTruthy()
    expect(secret!.length, 'placeholder must clear the length gate to be a real test').toBeGreaterThanOrEqual(32)
    expect(getEnvironmentIssue({ ENVIRONMENT: 'production', JWT_SECRET: secret! } as never)).toMatch(/placeholder/i)
  })

  it('rejects missing and short secrets', () => {
    expect(getEnvironmentIssue({ ENVIRONMENT: 'production', JWT_SECRET: '' } as never)).toMatch(/missing or shorter/i)
    expect(getEnvironmentIssue({ ENVIRONMENT: 'production', JWT_SECRET: 'short' } as never)).toMatch(/missing or shorter/i)
  })

  it('rejects an unknown environment value', () => {
    expect(getEnvironmentIssue({ ENVIRONMENT: 'prod', JWT_SECRET: 'K7f2Qp9wLm4XvR8tYc1ZbN6hJ3sD5gA0eU' } as never)).toMatch(/ENVIRONMENT/i)
    expect(getEnvironmentIssue({ ENVIRONMENT: undefined, JWT_SECRET: 'K7f2Qp9wLm4XvR8tYc1ZbN6hJ3sD5gA0eU' } as never)).toMatch(/ENVIRONMENT/i)
  })

  it('accepts a generated secret', () => {
    expect(getEnvironmentIssue({ ENVIRONMENT: 'production', JWT_SECRET: 'K7f2Qp9wLm4XvR8tYc1ZbN6hJ3sD5gA0eU' } as never)).toBeNull()
  })
})
