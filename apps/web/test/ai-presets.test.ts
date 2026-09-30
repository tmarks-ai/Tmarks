import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUILT_IN_PRESETS, parsePresetManifest, type PresetManifest } from '@tmarks/ai'

/**
 * public/ai-presets.json 是扩展端"Web 下发服务商预设"的源头(worker 静态资源
 * 托管在 ${origin}/ai-presets.json)。本测试保证:文件始终通过扩展端的同款
 * 校验(否则扩展会整体 fail-closed 回退内置清单),且不遗漏任何内置预设
 * ——新增服务商可以先只改这份文件,但把内置某家从清单删掉等于让所有
 * 已部署扩展回退到旧 URL,不允许悄悄发生。
 */
const manifestPath = resolve(process.cwd(), 'public/ai-presets.json')

function loadManifest(): PresetManifest {
  const parsed = parsePresetManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
  if (!parsed) throw new Error('ai-presets.json failed schema validation')
  return parsed
}

describe('web ai-presets.json', () => {
  it('passes the same validation the extension applies', () => {
    expect(loadManifest().schema_version).toBe(1)
  })

  it('covers every built-in preset id', () => {
    const ids = new Set(loadManifest().providers.map((preset) => preset.id))
    for (const preset of BUILT_IN_PRESETS) {
      expect(ids.has(preset.id), `manifest is missing built-in preset: ${preset.id}`).toBe(true)
    }
  })

  it('keeps preset ids unique', () => {
    const ids = loadManifest().providers.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('serves https-only base URLs', () => {
    for (const preset of loadManifest().providers) {
      expect(preset.baseUrl.startsWith('https://'), `${preset.id} must be https`).toBe(true)
    }
  })
})
