import { describe, expect, it } from 'vitest'
import { hasPermission, normalizePermissions, getInvalidPermissions } from '../src/permissions'

/**
 * hasPermission gates every data route (requireDataAuth) — it had zero test
 * coverage despite being the single authorization decision for API keys.
 */
describe('hasPermission', () => {
  it('grants an exact permission', () => {
    expect(hasPermission(['bookmarks.read'], 'bookmarks.read')).toBe(true)
  })

  it('denies when nothing matches', () => {
    expect(hasPermission([], 'bookmarks.read')).toBe(false)
    expect(hasPermission(['bookmarks.create'], 'bookmarks.read')).toBe(false)
    expect(hasPermission(['bookmarks.read'], 'bookmarks.read.extra')).toBe(false)
  })

  it('grants through a namespace wildcard', () => {
    expect(hasPermission(['bookmarks.*'], 'bookmarks.read')).toBe(true)
    expect(hasPermission(['bookmarks.*'], 'bookmarks.delete')).toBe(true)
    expect(hasPermission(['bookmarks.*'], 'bookmarks.read.extra')).toBe(true)
  })

  it('never lets a wildcard cross namespaces (prefix must be a full segment)', () => {
    // 'bookmarks.*' must not grant 'bookmark_folders.create' even though the
    // string starts with 'bookmark'.
    expect(hasPermission(['bookmarks.*'], 'bookmark_folders.create')).toBe(false)
    expect(hasPermission(['tab_groups.*'], 'tags.create')).toBe(false)
    // A bare wildcard without a namespace prefix matches nothing.
    expect(hasPermission(['*'], 'bookmarks.read')).toBe(false)
    expect(hasPermission(['*.*'], 'bookmarks.read')).toBe(false)
  })

  it('does not treat a plain permission as a wildcard', () => {
    // 'bookmarks.read' ends with neither '.*' nor grants prefixes.
    expect(hasPermission(['bookmarks.read'], 'bookmarks.read.extra')).toBe(false)
  })

  it('checks every granted permission, not just the first', () => {
    expect(hasPermission(['tags.read', 'bookmarks.*'], 'bookmarks.create')).toBe(true)
  })
})

describe('normalizePermissions / getInvalidPermissions', () => {
  it('drops unknown permissions and duplicates, preserving first-seen order', () => {
    expect(normalizePermissions(['bookmarks.read', 'nope', 'bookmarks.read', 'tags.create'])).toEqual([
      'bookmarks.read',
      'tags.create',
    ])
  })

  it('reports exactly the unknown entries', () => {
    expect(getInvalidPermissions(['bookmarks.read', 'evil.grant', 'evil.grant'])).toEqual([
      'evil.grant',
      'evil.grant',
    ])
  })
})
