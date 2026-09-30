const SLUG_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/**
 * Unguessable public-share slug: 16 uniform base62 chars ≈ 95.3 bits of
 * entropy, combined with rate limiting on the unauthenticated share endpoint
 * (routes/public-share.ts) and slug-conflict detection. User-chosen slugs
 * remain available for those who accept the enumeration risk of short names.
 */
export function generateSlug(length = 16): string {
  // Rejection sampling: 256 % 62 != 0, so naive modulo would bias the first
  // eight alphabet positions. Accept only bytes < 248 (4 × 62).
  const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
  let slug = ''
  let accepted = 0
  for (let i = 0; i < bytes.length && accepted < length; i += 1) {
    if (bytes[i] < 248) {
      slug += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length]
      accepted += 1
    }
  }
  if (slug.length < length) {
    // Probability of needing more entropy is negligible; loop rather than fail.
    return generateSlug(length)
  }
  return slug
}

/**
 * Escape LIKE wildcards so user input matches literally. Pair with
 * `ESCAPE '\'` in the SQL (SQLite default escape character).
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}