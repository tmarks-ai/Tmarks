import { describe, expect, it } from 'vitest'
import { dateFnsLocale, intlLocale, isChineseLocale } from '@/lib/locale'

describe('locale resolution', () => {
  // Regression: matching was split between `startsWith('zh')` and
  // `=== 'zh-CN'`, so a detected `zh` or `zh-TW` produced a Chinese UI with
  // en-US dates. Every Chinese variant must resolve the same way.
  it('treats every Chinese variant as Chinese', () => {
    for (const tag of ['zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-HK', 'ZH-cn']) {
      expect(isChineseLocale(tag), tag).toBe(true)
      expect(intlLocale(tag), tag).toBe('zh-CN')
    }
  })

  it('falls back to English for everything else', () => {
    for (const tag of ['en', 'en-US', 'fr', 'ja', '', undefined]) {
      expect(isChineseLocale(tag), String(tag)).toBe(false)
      expect(intlLocale(tag), String(tag)).toBe('en-US')
    }
  })

  it('returns matching date-fns locales', () => {
    expect(dateFnsLocale('zh-TW').code).toBe(dateFnsLocale('zh-CN').code)
    expect(dateFnsLocale('en-US').code).not.toBe(dateFnsLocale('zh-CN').code)
  })
})
