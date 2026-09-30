/**
 * API Key generator.
 * Key format: tmk_(live|test)_[20 base62 chars]
 */

export async function generateApiKey(env: 'live' | 'test' = 'live'): Promise<{
  key: string
  prefix: string
  hash: string
}> {
  const key = `tmk_${env}_${randomBase62(20)}`
  const prefix = key.substring(0, 13) // tmk_live_1a2b

  const hash = await hashApiKey(key)

  return { key, prefix, hash }
}

const BASE62_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
// 256 is not a multiple of 62, so `byte % 62` would make the first 8 characters
// ~25% likelier than the rest. Reject the biased tail instead (248 = 62 * 4),
// matching generateSlug in lib/utils.ts.
const BASE62_REJECT_THRESHOLD = 248

function randomBase62(length: number): string {
  let out = ''
  while (out.length < length) {
    const bytes = new Uint8Array(length - out.length)
    crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= BASE62_REJECT_THRESHOLD) continue
      out += BASE62_CHARS[byte % BASE62_CHARS.length]
    }
  }
  return out
}

/**
 * SHA256 hex hash of the raw API key (stored server-side; never store the raw key).
 */
export async function hashApiKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)

  const hashArray = new Uint8Array(hashBuffer)
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function isValidApiKeyFormat(key: string): boolean {
  const pattern = /^tmk_(live|test)_[a-zA-Z0-9]{20}$/
  return pattern.test(key)
}
