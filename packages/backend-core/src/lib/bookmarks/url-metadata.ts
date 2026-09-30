/**
 * URL metadata extraction for the bookmark form: title / description / favicon
 * / cover image from a fetched page's HTML head.
 *
 * The parser is a pure regex-based function (no DOMParser — Workers has none)
 * so it is fully unit-testable. The route (routes/bookmarks/url-metadata.ts)
 * fetches the page server-side: the user's browsing stays out of third-party
 * favicon services (the privacy-first alternative to client-side Google s2
 * lookups, which would leak every saved domain to Google).
 */

export interface UrlMetadata {
  title: string | null
  description: string | null
  favicon: string | null
  cover_image: string | null
}

interface LinkTag {
  rel: string
  href: string
  sizes: string
}

interface MetaTag {
  key: string
  content: string
}

export function parseHeadMetadata(html: string, baseUrl: string): UrlMetadata {
  const links = matchTags(html, /<link\b[^>]*>/gi).map(parseLinkTag).filter((l): l is LinkTag => Boolean(l.href))
  const metas = matchTags(html, /<meta\b[^>]*>/gi).map(parseMetaTag).filter((m): m is MetaTag => Boolean(m.key))

  const meta = (name: string): string | null => {
    const hit = metas.find((m) => m.key === name && m.content)
    return hit?.content ?? null
  }

  return {
    title: cleanText(meta('og:title') ?? matchTitle(html), 500),
    description: cleanText(meta('og:description') ?? meta('description'), 1000),
    favicon: pickFavicon(links, baseUrl),
    cover_image: absoluteUrl(meta('og:image') ?? meta('twitter:image'), baseUrl),
  }
}

/** 与 REST 面同口径:折叠空白、截断;实体解码已在属性解析时完成。 */
function cleanText(value: string | null, maxLength: number): string | null {
  if (!value) return null
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.slice(0, maxLength) || null
}

function matchTags(html: string, pattern: RegExp): string[] {
  const tags: string[] = []
  for (const match of html.matchAll(pattern)) {
    if (match[0]) tags.push(match[0])
  }
  return tags
}

/** `<title>` content (og:title is preferred by the caller). */
function matchTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match?.[1]) return null
  const decoded = decodeEntities(match[1])
  return decoded.trim().slice(0, 500) || null
}

/**
 * Favicon selection mirrors the extension's content extractor:
 * apple-touch-icon first, then the largest declared `sizes`, then any icon
 * link. Candidates failing the http(s) check are skipped, and when nothing
 * usable remains, the conventional `${origin}/favicon.ico` is suggested.
 */
function pickFavicon(links: LinkTag[], baseUrl: string): string | null {
  const icons = links.filter((l) => /\bicon\b/i.test(l.rel))

  const candidates: (string | null)[] = []

  const apple = icons.find((l) => /apple-touch-icon/i.test(l.rel))
  if (apple) candidates.push(absoluteUrl(apple.href, baseUrl))

  const sized = icons
    .map((l) => ({ link: l, size: parseSize(l.sizes) }))
    .filter((entry) => entry.size > 0)
    .sort((a, b) => b.size - a.size)
  if (sized.length > 0) candidates.push(absoluteUrl(sized[0]!.link.href, baseUrl))

  if (icons.length > 0) candidates.push(absoluteUrl(icons[0]!.href, baseUrl))

  for (const candidate of candidates) {
    if (candidate) return candidate
  }
  try {
    return new URL('/favicon.ico', baseUrl).href
  } catch {
    return null
  }
}

function parseSize(sizes: string): number {
  // "32x32 16x16" — take the largest declared edge.
  let max = 0
  for (const match of sizes.matchAll(/(\d+)\s*x\s*(\d+)/gi)) {
    max = Math.max(max, Number(match[1]), Number(match[2]))
  }
  return max
}

function parseLinkTag(tag: string): LinkTag {
  const attrs = parseAttributes(tag)
  return {
    rel: attrs.rel ?? '',
    href: attrs.href ?? '',
    sizes: attrs.sizes ?? '',
  }
}

function parseMetaTag(tag: string): MetaTag {
  const attrs = parseAttributes(tag)
  const key = (attrs.name ?? attrs.property ?? '').toLowerCase()
  return { key, content: attrs.content ?? '' }
}

/** Attribute order in real-world HTML is arbitrary; extract by name, not position. */
function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    const name = match[1]!.toLowerCase()
    const value = match[3] ?? match[4] ?? match[5] ?? ''
    if (!(name in attrs)) attrs[name] = decodeEntities(value)
  }
  return attrs
}

/** Resolve against the page URL; invalid/relative-unresolvable values are dropped. */
function absoluteUrl(value: string | null, baseUrl: string): string | null {
  if (!value) return null
  try {
    const resolved = new URL(value, baseUrl)
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null
    return resolved.href
  } catch {
    return null
  }
}

const NAMED_ENTITIES: Record<string, string> = {
  quot: '"',
  amp: '&',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  middot: '·',
  bull: '•',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => safeCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => safeCodePoint(Number(code)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => NAMED_ENTITIES[name] ?? match)
}

function safeCodePoint(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
}
