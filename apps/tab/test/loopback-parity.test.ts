import { describe, expect, it } from 'vitest'
import { isLoopbackHostname } from '../src/lib/api/config'
import { isLoopbackAIHostname, validateCustomBaseUrl } from '@tmarks/ai'

/**
 * R8 CA-7 parity pin: the loopback predicate exists in two copies on purpose —
 * config.ts cannot statically import @tmarks/ai (it would drag the AI package
 * into every first-load bundle), so the duplicate stays. This test imports
 * BOTH and asserts identical verdicts over a corpus, so a future edit to one
 * copy that forgets the other goes red immediately.
 */
const corpus: Array<[string, boolean]> = [
  ['localhost', true],
  ['LOCALHOST', true],
  ['127.0.0.1', true],
  ['::1', true],
  ['[::1]', true], // WHATWG URL.hostname bracket form
  ['0.0.0.0', false],
  ['::2', false],
  ['example.com', false],
  ['localhost.evil.com', false],
  ['', false],
]

describe('loopback hostname predicate parity (R8 CA-7)', () => {
  it('config.isLoopbackHostname and ai.isLoopbackAIHostname agree on the corpus', () => {
    for (const [hostname, expected] of corpus) {
      expect(isLoopbackHostname(hostname), `config(${hostname})`).toBe(expected)
      expect(isLoopbackAIHostname(hostname), `ai(${hostname})`).toBe(expected)
    }
  })

  it('a URL that one gate accepts is accepted by the other (end-to-end shapes)', () => {
    for (const url of ['http://localhost:9000/v1', 'http://127.0.0.1:11434', 'http://[::1]:9000/v1']) {
      const parsed = new URL(url)
      expect(isLoopbackHostname(parsed.hostname), url).toBe(true)
      // validateCustomBaseUrl runs the passed predicate — the same URL must
      // clear the ai package's gate too (string verdict, not a boolean).
      expect(validateCustomBaseUrl(url, isLoopbackAIHostname), url).toBe('ok')
    }
  })
})
