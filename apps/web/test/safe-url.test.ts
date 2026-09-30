import { describe, expect, it } from 'vitest'
import { safeHttpUrl, safeImageSrc } from '@/lib/safe-url'

/**
 * safe-url 是 Web 端 XSS 一线防线:每个书签 href / favicon / 封面 src 都经过它
 * (R5 审计:全站零 dangerouslySetInnerHTML 依赖此函数兜底)。此前零测试覆盖,
 * 本文件把审计中人工核实的拒绝语义钉成回归门。
 */
describe('safeHttpUrl (protocol allow-list for href)', () => {
  it('accepts http and https and returns the normalized href', () => {
    expect(safeHttpUrl('https://example.com/path?q=1#frag')).toBe('https://example.com/path?q=1#frag')
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/')
  })

  it('rejects script-execution and data-leak protocols', () => {
    for (const dangerous of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
      'about:blank',
      'blob:https://example.com/uuid',
      'ftp://example.com/file',
      'intent://example.com/#Intent;scheme=http',
    ]) {
      expect(safeHttpUrl(dangerous), dangerous).toBeUndefined()
    }
  })

  it('rejects classic scheme-obfuscation bypasses', () => {
    // WHATWG URL 在解析前剥除整个输入中的 Tab/换行:java\tscript: 会被规范化为
    // javascript: 再被协议白名单拒绝,而不是因为解析失败而漏过。
    expect(safeHttpUrl('java\tscript:alert(1)')).toBeUndefined()
    expect(safeHttpUrl('java\nscript:alert(1)')).toBeUndefined()
    // 前导空白同理剥除后规范化。
    expect(safeHttpUrl('  javascript:alert(1)')).toBeUndefined()
  })

  it('returns undefined for empty, null, and unparseable inputs', () => {
    expect(safeHttpUrl('')).toBeUndefined()
    expect(safeHttpUrl(null)).toBeUndefined()
    expect(safeHttpUrl(undefined)).toBeUndefined()
    expect(safeHttpUrl('not a url at all')).toBeUndefined()
    expect(safeHttpUrl('https://')).toBeUndefined()
  })
})

describe('safeImageSrc (asset-src allow-list for favicons/covers)', () => {
  it('allows same-origin /api/ asset paths (persisted favicon/cover form)', () => {
    const assetUrl = '/api/public/assets/favicon/' + 'a'.repeat(64)
    expect(safeImageSrc(assetUrl)).toBe(assetUrl)
    expect(safeImageSrc('/api/v1/assets/cover/xyz')).toBe('/api/v1/assets/cover/xyz')
  })

  it('rejects other relative paths (only /api/ is exempt)', () => {
    expect(safeImageSrc('/assets/logo.png')).toBeUndefined()
    expect(safeImageSrc('assets/logo.png')).toBeUndefined()
    expect(safeImageSrc('../api/public/assets/favicon/xyz')).toBeUndefined()
    expect(safeImageSrc('//evil.example.com/pixel.png')).toBeUndefined()
  })

  it('still applies the protocol allow-list to absolute image URLs', () => {
    expect(safeImageSrc('https://cdn.example.com/img.png')).toBe('https://cdn.example.com/img.png')
    expect(safeImageSrc('http://cdn.example.com/img.png')).toBe('http://cdn.example.com/img.png')
    expect(safeImageSrc('javascript:alert(1)')).toBeUndefined()
    expect(safeImageSrc('data:image/svg+xml,<svg onload=alert(1)>')).toBeUndefined()
  })

  it('handles null/undefined/empty like safeHttpUrl', () => {
    expect(safeImageSrc(null)).toBeUndefined()
    expect(safeImageSrc(undefined)).toBeUndefined()
    expect(safeImageSrc('')).toBeUndefined()
  })
})
