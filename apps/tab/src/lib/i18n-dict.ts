/**
 * TMark 扩展 i18n 字典 barrel(popup / options / notifications / format / background 共用)。
 * zh/en 键集一致,便于 diff。主字典拆到 i18n-zh.ts / i18n-en.ts,新增键拆到
 * i18n-extra-zh.ts / i18n-extra-en.ts,均以保持每文件 ≤300 行。
 * 扁平键 + {{var}} 插值;缺失时按 `dict[locale][key] ?? dict.zh[key] ?? key` 回退。
 *
 * zh 字典静态打进各入口主包(主要用户群,零额外请求);en 四个字典动态装载
 * (ensureEnDict)——popup 每次打开都是冷进程,静态双语会把 i18n chunk 撑到
 * ~150KB 且全部同步解析。装载完成前 en 回退 zh(仅冷启动首毫秒可见)。
 */
import { zh } from './i18n-zh'
import { extraZh } from './i18n-extra-zh'
import { popupZh } from './i18n-popup-zh'
import { optionsZh } from './i18n-options-zh'

export const dict: { zh: Record<string, string>; en: Record<string, string> } = {
  zh: { ...zh, ...extraZh, ...popupZh, ...optionsZh },
  en: {},
}

let enDictPromise: Promise<void> | null = null

/** 动态装载 en 字典(幂等);仅 en 语言用户触发,zh 用户不产生额外 chunk 请求。 */
export function ensureEnDict(): Promise<void> {
  if (!enDictPromise) {
    enDictPromise = Promise.all([
      import('./i18n-en'),
      import('./i18n-extra-en'),
      import('./i18n-popup-en'),
      import('./i18n-options-en'),
    ]).then(([a, b, c, d]) => {
      dict.en = { ...a.en, ...b.extraEn, ...c.popupEn, ...d.optionsEn }
    })
  }
  return enDictPromise
}
