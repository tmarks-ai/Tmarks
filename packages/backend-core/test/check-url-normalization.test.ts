import { describe, expect, it } from 'vitest'
import { normalizeBookmarkUrl } from '../src/lib/bookmarks/bookmark-url'

describe('bookmark URL check normalization', () => {
  it('removes hashes and one trailing slash while normalizing protocol and host', () => {
    expect(normalizeBookmarkUrl(' HTTPS://Example.COM/Path/#section ')).toBe('https://example.com/Path')
  })

  it('preserves path case, query parameters, ports, and protocol identity', () => {
    expect(normalizeBookmarkUrl('https://Example.com/Path/?q=1#x')).toBe('https://example.com/Path/?q=1')
    expect(normalizeBookmarkUrl('http://example.com/path')).not.toBe('https://example.com/path')
    expect(normalizeBookmarkUrl('https://example.com:8443/path')).toBe('https://example.com:8443/path')
  })

  it('trims plain invalid values without lowercasing their content', () => {
    expect(normalizeBookmarkUrl('  not a url/  ')).toBe('not a url')
  })
})
