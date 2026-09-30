import type { ClassifyOptions } from './types'
import { storageAdapterFor } from './storage'

const AI_ORGANIZER_SETTINGS_KEY = 'tmarks.ai.organizerSettings'

type AIOrganizerLanguageSetting = 'auto' | NonNullable<ClassifyOptions['language']>

export interface AIOrganizerSettings {
  language: AIOrganizerLanguageSetting
  promptStyle: string
  /** 自定义系统提示词(覆盖内置锁定契约)。空串=用内置 buildSystemPrompt();非空=完全替代内置。 */
  customSystemPrompt: string
  temperature: number
  titleLength: NonNullable<ClassifyOptions['titleLength']>
  descriptionDetail: NonNullable<ClassifyOptions['descriptionDetail']>
  tagCount: number
}

/** 用户自定义偏好（tagStyle）的默认模板：仅补充风格，不覆盖数据契约。参考旧版 DEFAULT_PROMPT_TEMPLATE。 */
export const DEFAULT_PROMPT_TEMPLATE = [
  '请优先复用我的已有文件夹和已有标签。',
  '分类要稳定，标签要短、准、有检索价值。',
  '保留重要专有名词，例如 Linux、GitHub、Cloudflare、Cursor、OpenAI。',
  '不要生成"其他、网页、资料、链接、do、topic"这类弱标签。',
].join('\n')

const DEFAULT_AI_ORGANIZER_SETTINGS: AIOrganizerSettings = {
  language: 'auto',
  promptStyle: DEFAULT_PROMPT_TEMPLATE,
  customSystemPrompt: '',
  temperature: 0.5,
  titleLength: 'medium',
  descriptionDetail: 'short',
  tagCount: 5,
}

export async function getAIOrganizerSettings(): Promise<AIOrganizerSettings> {
  return normalizeAIOrganizerSettings(await readStorageValue(AI_ORGANIZER_SETTINGS_KEY))
}

export async function saveAIOrganizerSettings(input: Partial<AIOrganizerSettings>): Promise<AIOrganizerSettings> {
  const current = await getAIOrganizerSettings()
  const next = normalizeAIOrganizerSettings({ ...current, ...input })
  await writeStorageValue(AI_ORGANIZER_SETTINGS_KEY, next)
  return next
}

function normalizeAIOrganizerSettings(value: unknown): AIOrganizerSettings {
  if (!value || typeof value !== 'object') return DEFAULT_AI_ORGANIZER_SETTINGS
  const record = value as Record<string, unknown>
  return {
    language: normalizeAIOrganizerLanguage(record.language),
    promptStyle: typeof record.promptStyle === 'string' ? record.promptStyle.trim().slice(0, 1200) : '',
    customSystemPrompt: typeof record.customSystemPrompt === 'string' ? record.customSystemPrompt.slice(0, 8000) : '',
    temperature: normalizeAIOrganizerTemperature(Number(record.temperature)),
    titleLength: normalizeAIOrganizerTitleLength(record.titleLength),
    descriptionDetail: normalizeAIOrganizerDescriptionDetail(record.descriptionDetail),
    tagCount: normalizeAIOrganizerTagCount(Number(record.tagCount)),
  }
}

function normalizeAIOrganizerLanguage(value: unknown): AIOrganizerLanguageSetting {
  return value === 'zh' || value === 'en' || value === 'mixed' ? value : 'auto'
}

function normalizeAIOrganizerTemperature(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_AI_ORGANIZER_SETTINGS.temperature
  return Math.max(0, Math.min(1, Math.round(value * 10) / 10))
}

function normalizeAIOrganizerTitleLength(value: unknown): AIOrganizerSettings['titleLength'] {
  return value === 'short' || value === 'long' ? value : 'medium'
}

function normalizeAIOrganizerDescriptionDetail(value: unknown): AIOrganizerSettings['descriptionDetail'] {
  return value === 'minimal' || value === 'detailed' ? value : 'short'
}

function normalizeAIOrganizerTagCount(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_AI_ORGANIZER_SETTINGS.tagCount
  return Math.max(3, Math.min(6, Math.round(value || DEFAULT_AI_ORGANIZER_SETTINGS.tagCount)))
}

async function readStorageValue(key: string): Promise<unknown> {
  return storageAdapterFor().get(key)
}

async function writeStorageValue(key: string, value: unknown) {
  await storageAdapterFor().set({ [key]: value })
}
