import { describe, expect, it, vi } from 'vitest'
import { getPbkdf2Iterations } from '../src/lib/config'
import { getDummyHashForLogin } from '../src/routes/auth/login'
import { hashPassword } from '../src/lib/crypto'
import type { Env } from '../src/lib/env'

vi.mock('../src/lib/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/crypto')>()
  return {
    ...actual,
    hashPassword: vi.fn(actual.hashPassword),
  }
})

/**
 * P1-1 regression (AUDIT-2026-09-11 四.1): the login timing-equalizer dummy
 * hash previously hard-coded crypto.ts's 600k-iteration default. The Workers
 * runtime hard-rejects PBKDF2 above 100k iterations (NotSupportedError), so
 * every unknown-username login on production 500'd instead of answering the
 * uniform 401 — reintroducing the account-existence oracle the equalizer
 * exists to close (live-confirmed 2026-09-11 across six smoke probes).
 *
 * The dummy hash must follow the SAME env-configured work factor as real
 * password hashes (getPbkdf2Iterations), so on Workers it is derived with
 * 100k and can never exceed the platform cap.
 */
describe('login dummy hash work factor', () => {
  it('derives the dummy hash with the env-configured iteration count', async () => {
    const hash = await getDummyHashForLogin(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '100000' } as Env))
    expect(hash.startsWith('pbkdf2_sha256:100000:')).toBe(true)
  })

  it('follows a raised env value instead of the crypto.ts constant', async () => {
    // A self-hoster raising the var must get the raised work factor on the
    // dummy path too — a silent fallback to a different count re-opens the
    // timing side channel between the two login failure branches.
    const hash = await getDummyHashForLogin(getPbkdf2Iterations({ PBKDF2_ITERATIONS: '150000' } as Env))
    expect(hash.startsWith('pbkdf2_sha256:150000:')).toBe(true)
  })

  it('caches per iteration count: a second derivation returns the same promise value', async () => {
    const first = await getDummyHashForLogin(100_000)
    const second = await getDummyHashForLogin(100_000)
    expect(first).toBe(second)
  })

  it('drops a poisoned cache entry on rejection instead of caching the failure forever (R5-6)', async () => {
    const mock = vi.mocked(hashPassword)
    mock.mockRejectedValueOnce(new Error('NotSupportedError: iteration counts above 100000 are not supported'))
    // First derivation rejects (the config-mistake scenario)...
    await expect(getDummyHashForLogin(200_000)).rejects.toThrow('NotSupportedError')
    // ...and the rejected promise must NOT stay cached: the next call retries
    // (and with the mock restored, succeeds). Pre-fix, every unknown-username
    // login for the isolate's lifetime inherited the cached rejection → 500,
    // while wrong-password logins stayed 401 — an account-existence oracle.
    const retry = await getDummyHashForLogin(200_000)
    expect(retry.startsWith('pbkdf2_sha256:200000:')).toBe(true)
    expect(mock.mock.calls.filter((call) => call[1] === 200_000)).toHaveLength(2)
  })
})
