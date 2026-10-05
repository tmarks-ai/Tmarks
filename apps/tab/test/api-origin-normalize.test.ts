import { describe, expect, it } from 'vitest'
import { normalizeApiOrigin } from '../src/lib/api/config'

/**
 * R8 TA-2 回归网:尾斜杠曾让每个 API 请求打中 `//api/...`(Workers 的
 * run_worker_first 只认单斜杠 /api/*,SPA HTML 被当 API 响应,队列按
 * NETWORK_ERROR 烧光重试预算);桥接比较也因字符串不等值而永久失活。
 */
describe('normalizeApiOrigin (R8 TA-2)', () => {
  it('strips trailing slashes and query/hash while keeping sub-path prefixes', () => {
    expect(normalizeApiOrigin('https://tmarks.example.com/')).toBe('https://tmarks.example.com')
    expect(normalizeApiOrigin('https://tmarks.example.com///')).toBe('https://tmarks.example.com')
    expect(normalizeApiOrigin('https://tmarks.example.com/?x=1#frag')).toBe('https://tmarks.example.com')
    expect(normalizeApiOrigin('https://tmarks.example.com/tmarks/')).toBe('https://tmarks.example.com/tmarks')
    expect(normalizeApiOrigin('http://localhost:8787/')).toBe('http://localhost:8787')
  })

  it('leaves already-normalized origins untouched and tolerates junk without throwing', () => {
    expect(normalizeApiOrigin('https://tmarks.example.com')).toBe('https://tmarks.example.com')
    expect(normalizeApiOrigin('  not a url  ')).toBe('not a url')
  })
})
