interface JWTPayload {
  sub: string
  exp: number
  iat: number
  session_id: string
}

export async function generateJWT(
  payload: Omit<JWTPayload, 'exp' | 'iat'>,
  secret: string,
  expiresIn = '30d'
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + parseExpiry(expiresIn)
  const fullPayload: JWTPayload = {
    ...payload,
    iat: now,
    exp,
  }
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }
  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload))
  const signature = await sign(`${encodedHeader}.${encodedPayload}`, secret)
  return `${encodedHeader}.${encodedPayload}.${signature}`
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid token format')
  }
  const [encodedHeader, encodedPayload, signature] = parts

  let header: { alg?: unknown; typ?: unknown }
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader))
  } catch {
    throw new Error('Invalid token header')
  }
  if (header.alg !== 'HS256') {
    throw new Error('Unsupported signing algorithm')
  }

  const expectedSignature = await sign(`${encodedHeader}.${encodedPayload}`, secret)
  if (!timingSafeEqualStr(signature, expectedSignature)) {
    throw new Error('Invalid signature')
  }
  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as JWTPayload
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp < now) {
    throw new Error('Token expired')
  }
  if (typeof payload.sub !== 'string' || typeof payload.session_id !== 'string') {
    throw new Error('Token is missing session binding')
  }
  return payload
}

export function extractJWT(request: Request): string | null {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }
  return authHeader.substring(7)
}

async function sign(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const dataBuffer = encoder.encode(data)
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, dataBuffer)
  return base64UrlEncode(signature)
}

function base64UrlEncode(data: string | ArrayBuffer): string {
  let base64: string
  if (typeof data === 'string') {
    base64 = btoa(data)
  } else {
    const bytes = new Uint8Array(data)
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
    base64 = btoa(binary)
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64UrlDecode(data: string): string {
  let base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }
  return atob(base64)
}

/** Constant-time string comparison (mirrors lib/crypto timingSafeEqual). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const bytesA = encoder.encode(a)
  const bytesB = encoder.encode(b)
  if (bytesA.length !== bytesB.length) {
    return false
  }
  let result = 0
  for (let i = 0; i < bytesA.length; i++) {
    result |= bytesA[i] ^ bytesB[i]
  }
  return result === 0
}

export function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([smhd])$/)
  if (!match) {
    throw new Error('Invalid expiry format')
  }
  const value = parseInt(match[1], 10)
  const unit = match[2]
  switch (unit) {
    case 's':
      return value
    case 'm':
      return value * 60
    case 'h':
      return value * 60 * 60
    case 'd':
      return value * 24 * 60 * 60
    default:
      throw new Error('Invalid expiry unit')
  }
}
