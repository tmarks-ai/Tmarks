import { describe, expect, it } from 'vitest'
import { parseHeadMetadata } from '../src/lib/bookmarks/url-metadata'

const BASE = 'https://example.com/docs/page'

describe('parseHeadMetadata', () => {
  it('extracts og:title/description, apple-touch-icon and og:image', () => {
    const html = `
      <html><head>
        <title>Fallback Title</title>
        <meta property="og:title" content="OG Title">
        <meta name="description" content="A page about things">
        <link rel="apple-touch-icon" href="/apple-icon.png">
        <link rel="icon" href="/favicon-32.png" sizes="32x32">
        <meta property="og:image" content="https://cdn.example.com/cover.jpg">
      </head><body></body></html>`
    expect(parseHeadMetadata(html, BASE)).toEqual({
      title: 'OG Title',
      description: 'A page about things',
      favicon: 'https://example.com/apple-icon.png',
      cover_image: 'https://cdn.example.com/cover.jpg',
    })
  })

  it('falls back to <title> and og:description when og:* are missing', () => {
    const html = `<head><title>Plain</title>
      <meta property="og:description" content="OG desc">
      <link rel="shortcut icon" href="https://static.example.com/icon.ico">
      </head>`
    const meta = parseHeadMetadata(html, BASE)
    expect(meta.title).toBe('Plain')
    expect(meta.description).toBe('OG desc')
    expect(meta.favicon).toBe('https://static.example.com/icon.ico')
    expect(meta.cover_image).toBeNull()
  })

  it('picks the largest declared icon size when apple-touch-icon is absent', () => {
    const html = `<head>
      <link rel="icon" type="image/png" sizes="16x16" href="/16.png">
      <link rel="icon" type="image/png" sizes="192x192" href="/192.png">
      <link rel="icon" type="image/png" sizes="48x48" href="/48.png">
    </head>`
    expect(parseHeadMetadata(html, BASE).favicon).toBe('https://example.com/192.png')
  })

  it('handles attribute order variations (sizes before href, single quotes)', () => {
    const html = `<head><link sizes='64x64' rel="icon" href='/icon64.png'></head>`
    expect(parseHeadMetadata(html, BASE).favicon).toBe('https://example.com/icon64.png')
  })

  it('falls back to /favicon.ico when the page declares no icon', () => {
    const html = `<head><title>No icons</title></head>`
    expect(parseHeadMetadata(html, BASE).favicon).toBe('https://example.com/favicon.ico')
  })

  it('resolves relative og:image against the page URL', () => {
    const html = `<head><meta property="og:image" content="/assets/og.png"></head>`
    expect(parseHeadMetadata(html, BASE).cover_image).toBe('https://example.com/assets/og.png')
  })

  it('drops non-http(s) icon and image values (javascript: / data:)', () => {
    const html = `<head>
      <link rel="icon" href="javascript:alert(1)">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <meta property="og:image" content="javascript:alert(2)">
    </head>`
    const meta = parseHeadMetadata(html, BASE)
    // Non-http candidates are rejected → /favicon.ico fallback.
    expect(meta.favicon).toBe('https://example.com/favicon.ico')
    expect(meta.cover_image).toBeNull()
  })

  it('decodes basic entities in titles and truncates to 500 chars', () => {
    const long = 'x'.repeat(600)
    const html = `<head><title>Tom &amp; Jerry &quot;quoted&quot;</title><meta property="og:title" content="${long}"></head>`
    const meta = parseHeadMetadata(html, BASE)
    expect(meta.title).toHaveLength(500)
    expect(parseHeadMetadata('<title>Tom &amp; Jerry</title>', BASE).title).toBe('Tom & Jerry')
  })

  it('returns nulls for HTML without any metadata', () => {
    const meta = parseHeadMetadata('<html><body>nothing</body></html>', BASE)
    expect(meta.title).toBeNull()
    expect(meta.description).toBeNull()
    expect(meta.cover_image).toBeNull()
    // favicon always has the conventional fallback.
    expect(meta.favicon).toBe('https://example.com/favicon.ico')
  })
})
