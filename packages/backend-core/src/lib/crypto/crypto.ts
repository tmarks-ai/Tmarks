// OWASP (2023) recommends ≥600k iterations for PBKDF2-HMAC-SHA256. Stored
// hashes embed their own iteration count (pbkdf2_sha256:<n>:<salt+hash>), so
// raising or lowering the constant only affects newly created hashes and old
// hashes keep verifying. The count is overridable per environment
// (getPbkdf2Iterations) for free-plan CPU limits.
const PBKDF2_ITERATIONS = 600_000
const SALT_LENGTH = 16
const HASH_LENGTH = 32

export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const encoder = new TextEncoder()
  const passwordBuffer = encoder.encode(password)

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8
  )

  const hash = new Uint8Array(hashBuffer)
  const result = new Uint8Array(salt.length + hash.length)
  result.set(salt, 0)
  result.set(hash, salt.length)

  return `pbkdf2_sha256:${iterations}:${arrayBufferToBase64(result)}`
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    const parts = hash.split(':')
    if (parts.length !== 3 || parts[0] !== 'pbkdf2_sha256') {
      return false
    }
    const iterations = parseInt(parts[1], 10)
    const storedHash = base64ToArrayBuffer(parts[2])
    const salt = storedHash.slice(0, SALT_LENGTH)
    const originalHash = storedHash.slice(SALT_LENGTH)
    const encoder = new TextEncoder()
    const passwordBuffer = encoder.encode(password)
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      'PBKDF2',
      false,
      ['deriveBits']
    )
    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      HASH_LENGTH * 8
    )
    const computedHash = new Uint8Array(hashBuffer)
    return timingSafeEqual(originalHash, computedHash)
  } catch {
    return false
  }
}

export function generateToken(length = 32): string {
  const array = crypto.getRandomValues(new Uint8Array(length))
  return arrayBufferToBase64(array)
}

export async function hashRefreshToken(token: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(token)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return arrayBufferToBase64(new Uint8Array(hashBuffer))
}

export function generateUUID(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false
  }
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i]
  }
  return result === 0
}

function arrayBufferToBase64(buffer: Uint8Array): string {
  const binary = Array.from(buffer, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
