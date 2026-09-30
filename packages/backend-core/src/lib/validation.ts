export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function sanitizeString(str: string, maxLength = 1000): string {
  return str.trim().slice(0, maxLength)
}

/**
 * Sanitize an outbound URL for storage/rendering: trim, cap length, and allow
 * only http(s). Returns '' for anything else (javascript:, data:, file:, …) so
 * callers can skip the item instead of persisting an XSS-capable href. Unlike
 * bookmarks, tab-group items previously only ran sanitizeString (no protocol
 * check), which let javascript: URLs reach anchor hrefs in the web app.
 */
export function sanitizeUrl(url: string, maxLength = 2000): string {
  const trimmed = sanitizeString(url, maxLength)
  if (!isValidUrl(trimmed)) return ''
  return trimmed
}

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3,8}$/

export function isValidHexColor(color: string): boolean {
  return HEX_COLOR_PATTERN.test(color)
}

/** Normalize a user-supplied color to a valid #rrggbb value, or null. */
export function sanitizeColor(color: string | null | undefined): string | null {
  const trimmed = sanitizeString(color ?? '', 9)
  return isValidHexColor(trimmed) ? trimmed : null
}
