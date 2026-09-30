import { describe, expect, it } from 'vitest'
import { normalizeBookmarkRow, normalizeTabGroupItemRow } from '../src/lib/sync/normalize'

describe('normalize URL hardening (server → client trust boundary)', () => {
  it('keeps http/https bookmark urls', () => {
    expect(normalizeBookmarkRow({ id: 'b1', url: 'https://example.com/a' }).dto.url).toBe('https://example.com/a')
    expect(normalizeBookmarkRow({ id: 'b1', url: 'http://example.com/a' }).dto.url).toBe('http://example.com/a')
  })
  it('blanks javascript: bookmark urls coming from the server', () => {
    expect(normalizeBookmarkRow({ id: 'b1', url: 'javascript:alert(document.cookie)' }).dto.url).toBe('')
  })
  it('blanks data: bookmark urls coming from the server', () => {
    expect(normalizeBookmarkRow({ id: 'b1', url: 'data:text/html,<script>alert(1)</script>' }).dto.url).toBe('')
  })
  it('blanks malformed bookmark urls', () => {
    expect(normalizeBookmarkRow({ id: 'b1', url: 'not-a-url' }).dto.url).toBe('')
  })

  it('keeps http tab group item urls', () => {
    expect(normalizeTabGroupItemRow({ id: 'i1', group_id: 'g1', url: 'http://example.com' }).dto.url).toBe('http://example.com')
  })
  it('blanks javascript: tab group item urls', () => {
    expect(normalizeTabGroupItemRow({ id: 'i1', group_id: 'g1', url: 'javascript:alert(1)' }).dto.url).toBe('')
  })
})
