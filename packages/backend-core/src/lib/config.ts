import type { Env } from './env'

const DEFAULT_CONFIG = {
  JWT_ACCESS_TOKEN_EXPIRES_IN: '1h',
  JWT_REFRESH_TOKEN_EXPIRES_IN: '30d',
} as const

export function getJwtAccessTokenExpiresIn(env?: Env): string {
  return env?.JWT_ACCESS_TOKEN_EXPIRES_IN || DEFAULT_CONFIG.JWT_ACCESS_TOKEN_EXPIRES_IN
}

export function getJwtRefreshTokenExpiresIn(env?: Env): string {
  return env?.JWT_REFRESH_TOKEN_EXPIRES_IN || DEFAULT_CONFIG.JWT_REFRESH_TOKEN_EXPIRES_IN
}

export function getEnvironment(env: Env): 'development' | 'production' {
  return env.ENVIRONMENT === 'production' ? 'production' : 'development'
}

const DEFAULT_PBKDF2_ITERATIONS = 100_000
const MIN_PBKDF2_ITERATIONS = 100_000
const MAX_PBKDF2_ITERATIONS = 2_000_000

/**
 * PBKDF2 iteration count for new password hashes. The Workers runtime hard-caps
 * PBKDF2 at 100_000 iterations — anything higher throws NotSupportedError
 * ("Pbkdf2 failed: iteration counts above 100000 are not supported") on every
 * register/login, so 100k is both the default and the platform maximum
 * (verified live 2026-09-10; the old 600k OWASP default 500'd all auth).
 * Local Node runtimes can go higher via the PBKDF2_ITERATIONS var; values
 * outside [100k, 2M] fall back to the default rather than silently accepting
 * a dangerously weak or DoS-prone setting.
 */
export function getPbkdf2Iterations(env: Env): number {
  const raw = Number(env.PBKDF2_ITERATIONS)
  if (!Number.isFinite(raw) || raw < MIN_PBKDF2_ITERATIONS || raw > MAX_PBKDF2_ITERATIONS) {
    return DEFAULT_PBKDF2_ITERATIONS
  }
  return Math.floor(raw)
}

/** Minimum length (bytes) accepted for JWT_SECRET before the worker serves traffic. */
const MIN_JWT_SECRET_LENGTH = 32

/**
 * Placeholder secrets shipped in .dev.vars.example and quoted in DEPLOY.md.
 * They are long enough to clear the length check, so without this a self-hoster
 * who copies the example file and forgets to edit it gets a worker running on a
 * secret that is published in this repository.
 */
const PLACEHOLDER_SECRET_MARKERS = ['change-me', 'changeme', 'your-secret', 'replace-me', 'example']

/**
 * Fail-closed environment gate: returns a human-readable problem description
 * when the JWT secret is missing, too weak, or still a published placeholder,
 * otherwise null. A guessable secret lets anyone forge HS256 tokens for
 * arbitrary user ids, so the worker must refuse to serve rather than start
 * insecurely.
 */
export function getEnvironmentIssue(env: Pick<Env, 'JWT_SECRET' | 'ENVIRONMENT'>): string | null {
  const environment = env.ENVIRONMENT
  if (environment !== 'development' && environment !== 'production') {
    return `ENVIRONMENT must be exactly "development" or "production"; received ${environment ? `"${environment}"` : 'no value'}.`
  }

  const secret = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET : ''
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    return `JWT_SECRET is missing or shorter than ${MIN_JWT_SECRET_LENGTH} characters. Set a strong secret (e.g. \`openssl rand -base64 32\`) via \`wrangler secret put JWT_SECRET\` or in .dev.vars.`
  }
  const lowered = secret.toLowerCase()
  if (PLACEHOLDER_SECRET_MARKERS.some((marker) => lowered.includes(marker))) {
    return 'JWT_SECRET is still the placeholder value from .dev.vars.example. Generate a real secret (e.g. `openssl rand -base64 32`) before serving traffic.'
  }
  return null
}
