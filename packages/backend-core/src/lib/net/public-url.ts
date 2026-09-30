/**
 * SSRF guard for outbound http(s) fetches (url-metadata + asset-persist).
 *
 * A hostname is only meaningful to us when it is NOT an IP literal in a
 * private/reserved range: loopback, RFC1918 private, link-local (incl. the
 * 169.254.169.254 cloud metadata address), CGNAT, unspecified, multicast,
 * reserved — and the IPv6 equivalents. Literal forms are checked syntactically,
 * including the exotic inet_aton spellings a workerd fetch would still resolve
 * ("2130706433", "0x7f.1", "127.1", "[::ffff:127.0.0.1]").
 *
 * Known limitation (documented in DEPLOY.md): a *domain name* that resolves to
 * an internal address cannot be detected here — the runtime offers no custom
 * DNS resolution. Redirects are therefore followed manually and every hop is
 * re-validated (see external-fetch.ts); on Cloudflare, the platform additionally
 * blocks egress to internal addresses, but self-hosted deployments cannot rely
 * on that, which is why the code-level guard exists.
 */

export function isPublicHttpUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return isPublicHostname(parsed.hostname)
}

export function isPublicHostname(rawHostname: string): boolean {
  let hostname = rawHostname.toLowerCase()
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1)
  // URL.hostname keeps the brackets on IPv6 literals ("[::1]").
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1)
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false
  if (hostname === '') return false

  if (hostname.includes(':')) {
    const groups = parseIpv6(hostname)
    return groups === null ? true : !isBlockedIpv6(groups)
  }

  const ipv4 = parseIpv4Like(hostname)
  if (ipv4 !== null) return !isBlockedIpv4(ipv4)
  // Anything else is a domain name (DNS-pinned resolution is out of scope).
  return true
}

/** Loopback/private/link-local/CGNAT/unspecified/multicast/reserved v4 ranges. */
export function isBlockedIpv4(ip: number): boolean {
  const a = (ip >>> 24) & 0xff
  const b = (ip >>> 16) & 0xff
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && (b & 0xc0) === 0x40) return true // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true // link-local (metadata service)
  if (a === 172 && (b & 0xf0) === 0x10) return true // 172.16.0.0/12
  if (a === 192 && b === 168) return true
  if ((a & 0xf0) === 0xe0 || (a & 0xf0) === 0xf0) return true // 224/4 + 240/4
  return false
}

function isBlockedIpv6(groups: number[]): boolean {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups
  if (groups.every((g) => g === 0)) return true // :: (unspecified)
  if ([g0, g1, g2, g3, g4, g5, g6].every((g) => g === 0) && g7 === 1) return true // ::1
  // IPv4-mapped ::ffff:0:0/96 — evaluate the embedded IPv4 address.
  if ([g0, g1, g2, g3, g4].every((g) => g === 0) && g5 === 0xffff) {
    return isBlockedIpv4(g6 * 0x10000 + g7)
  }
  if ((g0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true // ff00::/8 multicast
  if (g0 === 0x2002) return true // 2002::/16 6to4 — embedded IPv4, relay can target private space
  if (g0 === 0x0064 && g1 === 0xff9b) return true // 64:ff9b::/96 well-known NAT64 — maps the whole v4 space incl. loopback
  return false
}

/**
 * Parse "2130706433", "0x7f.1", "127.1" and dotted quads the way a fetch
 * resolver would (WHATWG "ends in a number" rule): the host is an IPv4
 * address only when its final label is numeric. Returns the address as an
 * unsigned 32-bit number, or null for real domain names.
 */
export function parseIpv4Like(hostname: string): number | null {
  const parts = hostname.split('.')
  if (parts.length > 4) return null
  const last = parts[parts.length - 1]!
  if (!/^(0x[0-9a-f]+|0[0-7]+|[0-9]+)$/.test(last)) return null

  const numbers: number[] = []
  for (const part of parts) {
    if (!/^(0x[0-9a-f]+|0[0-7]+|[0-9]+)$/.test(part)) return null
    const value = part.startsWith('0x')
      ? parseInt(part.slice(2), 16)
      : part.startsWith('0') && part.length > 1
        ? parseInt(part.slice(1), 8)
        : parseInt(part, 10)
    if (!Number.isSafeInteger(value)) return null
    numbers.push(value)
  }
  for (let i = 0; i < numbers.length - 1; i += 1) {
    if (numbers[i]! > 255) return null
  }
  const lastValue = numbers[numbers.length - 1]!
  if (lastValue >= 256 ** (5 - numbers.length)) return null

  // inet_aton semantics: leading parts are single bytes left-aligned, the
  // final part is a raw value covering the remaining low-order bytes —
  // "127.1" → 127.0.0.1, "1.2.3" → 1.2.0.3.
  let ip = lastValue
  for (let i = 0; i < numbers.length - 1; i += 1) {
    ip += numbers[i]! * 256 ** (3 - i)
  }
  return ip <= 0xffffffff ? ip : null
}

/** Strict four-decimal-dotted quad (used for the v4-in-v6 form). */
function parseDottedQuad(text: string): number | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let ip = 0
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null
    const value = parseInt(part, 10)
    if (value > 255) return null
    ip = ip * 256 + value
  }
  return ip
}

/** Parse an IPv6 literal ("::1", "fe80::1", "::ffff:127.0.0.1") into 8 groups. */
export function parseIpv6(text: string): number[] | null {
  const zoneStripped = text.includes('%') ? text.slice(0, text.indexOf('%')) : text
  if (!zoneStripped.includes(':')) return null
  const halves = zoneStripped.split('::')
  if (halves.length > 2) return null

  const head = halves[0] === '' ? [] : halves[0]!.split(':')
  const tail = halves.length === 2 && halves[1] !== '' ? halves[1]!.split(':') : []
  const headGroups: number[] = []
  const tailGroups: number[] = []
  for (const part of head) {
    const parsed = parseIpv6Part(part)
    if (parsed === null) return null
    headGroups.push(...parsed)
  }
  for (const part of tail) {
    const parsed = parseIpv6Part(part)
    if (parsed === null) return null
    tailGroups.push(...parsed)
  }

  if (halves.length === 1) return headGroups.length === 8 ? headGroups : null
  if (headGroups.length + tailGroups.length > 7) return null
  const fill = 8 - headGroups.length - tailGroups.length
  return [...headGroups, ...new Array<number>(fill).fill(0), ...tailGroups]
}

function parseIpv6Part(part: string): number[] | null {
  if (part.includes('.')) {
    const embedded = parseDottedQuad(part)
    if (embedded === null) return null
    return [(embedded >>> 16) & 0xffff, embedded & 0xffff]
  }
  if (!/^[0-9a-f]{1,4}$/.test(part)) return null
  return [parseInt(part, 16)]
}
