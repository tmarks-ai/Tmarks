/**
 * i18n 偏字典(zh):承载新增键,避免 i18n-zh.ts 超过 300 行硬限。
 * 团队先例见 i18n-dict.ts:主字典拆分以保每文件 ≤300。
 */
export const extraZh: Record<string, string> = {
  'settings.description': '配置后端地址与同步模式。',
}
