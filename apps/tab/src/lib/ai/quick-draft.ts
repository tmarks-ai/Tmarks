import { getActiveAIConnection } from '@tmarks/ai'
import { BookmarkOrganizer, type ClassifyInput } from './organizer'

interface QuickDraft {
  title: string
  description: string
  tags: string[]
  folderPath: string[]
  confidence: number | null
  ok: boolean
  error?: string
}

/**
 * popup 快速保存时的 AI 草稿:对当前页 URL 做单条分类,返回标题/描述/标签/文件夹路径。
 * 无可用 AI 连接或调用失败时回退到页面原始标题 + 空 tags(调用方兜底)。
 */
export async function buildQuickBookmarkDraft(input: {
  url: string
  title: string
  description?: string
  content?: string
  fallbackTag?: string
}): Promise<QuickDraft> {
  const connection = await getActiveAIConnection()
  if (!connection) {
    return { title: input.title, description: '', tags: input.fallbackTag ? [input.fallbackTag] : [], folderPath: [], confidence: null, ok: false, error: 'no AI connection' }
  }
  const classifyInput: ClassifyInput = { url: input.url, title: input.title, description: input.description, content: input.content }
  const organizer = new BookmarkOrganizer()
  const r = await organizer.classifyOne(classifyInput, connection)
  if (!r.ok) {
    return { title: input.title, description: '', tags: input.fallbackTag ? [input.fallbackTag] : [], folderPath: [], confidence: null, ok: false, error: r?.error }
  }
  return {
    title: r.parsed.title ?? input.title,
    description: r.parsed.description ?? '',
    tags: r.parsed.tags ?? [],
    folderPath: r.parsed.classification?.folderPath ?? [],
    confidence: typeof r.parsed.confidence === 'number' ? r.parsed.confidence : null,
    ok: true,
  }
}
