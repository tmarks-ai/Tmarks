import { describe, expect, it } from 'vitest'
import { buildTabGroupFingerprint } from '../src/lib/utils/fingerprint'

/**
 * 指纹必须真正"顺序无关"(查重注释的承诺):同一标签页集合在组内删除/重排
 * 后 position 出现空洞(0,2,3…),指纹不变——此前按 position 排序并写入指纹,
 * 删过一项的组永远查不到重复采集。
 */
describe('buildTabGroupFingerprint', () => {
  const items = [
    { title: 'Docs', url: 'https://docs.example.com', position: 0 },
    { title: 'Blog', url: 'https://blog.example.com', position: 1 },
    { title: 'App', url: 'https://app.example.com', position: 2 },
  ]

  it('is invariant under position gaps left by a deletion', () => {
    const gapped = [
      { title: 'Docs', url: 'https://docs.example.com', position: 0 },
      { title: 'App', url: 'https://app.example.com', position: 2 },
      { title: 'Blog', url: 'https://blog.example.com', position: 3 },
    ]
    expect(buildTabGroupFingerprint({ title: 'Group', parentId: null, items: gapped }))
      .toBe(buildTabGroupFingerprint({ title: 'Group', parentId: null, items }))
  })

  it('is invariant under input reordering', () => {
    expect(buildTabGroupFingerprint({ title: 'Group', parentId: null, items: [...items].reverse() }))
      .toBe(buildTabGroupFingerprint({ title: 'Group', parentId: null, items }))
  })

  it('normalizes title case and surrounding whitespace', () => {
    const noisy = items.map((it) => ({ ...it, title: `  ${it.title.toUpperCase()}  ` }))
    expect(buildTabGroupFingerprint({ title: ' Group ', parentId: null, items: noisy }))
      .toBe(buildTabGroupFingerprint({ title: 'Group', parentId: null, items }))
  })

  it('treats trailing-slash URL variants as different pages', () => {
    // 归一仅做 trim+lowercase,不做 URL 规范化——尾斜杠变体按不同页面记录
    // (与 normalizeUrlKey 的删除/采集路径不同,指纹保持保守)。
    const slashed = items.map((it) => ({ ...it, url: `${it.url}/` }))
    expect(buildTabGroupFingerprint({ title: 'Group', parentId: null, items: slashed }))
      .not.toBe(buildTabGroupFingerprint({ title: 'Group', parentId: null, items }))
  })
})
