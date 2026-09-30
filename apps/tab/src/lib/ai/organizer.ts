import {
  buildExistingBookmarkFolderContext,
  EXISTING_TAGS_PROMPT_LIMIT,
  EXISTING_FOLDERS_PROMPT_LIMIT,
  buildSingleBookmarkPrompt,
  callAI,
  canonicalizeTagsToExisting,
  getAIOrganizerSettings,
  normalizeBookmarkClassificationOutput,
  parseAIResponse,
  type AIConnectionInfo,
  type ClassifyOptions,
  type ExistingTagContext,
  type ParsedBookmarkData,
} from '@tmarks/ai'
import { db } from '../db'

export interface ClassifyInput {
  url: string
  title?: string
  description?: string
  content?: string
  tags?: string[]
  folderPath?: string[]
}

interface ClassifyResult {
  url: string
  parsed: ParsedBookmarkData
  ok: boolean
  error?: string
}

/** Single-page classification only. Batch organization is intentionally not exposed. */
export class BookmarkOrganizer {
  async classifyOne(input: ClassifyInput, connection: AIConnectionInfo): Promise<ClassifyResult> {
    const settings = await getAIOrganizerSettings()
    const { existingTags, existingTagContext, existingFolders, tagLibrarySize } = await loadContext()
    const options: ClassifyOptions = {
      connection,
      existingTags,
      existingTagContext,
      tagLibrarySize,
      existingFolders,
      sourceBookmarks: [input],
      temperature: settings.temperature,
      titleLength: settings.titleLength,
      descriptionDetail: settings.descriptionDetail,
      tagCount: settings.tagCount,
      language: settings.language === 'auto' ? undefined : settings.language,
      tagStyle: settings.promptStyle,
      customSystemPrompt: settings.customSystemPrompt,
    }

    try {
      const { system, user } = buildSingleBookmarkPrompt(input.url, options)
      const response = await callAI({
        provider: connection.provider,
        protocol: connection.protocol,
        baseUrl: connection.baseUrl,
        apiKey: connection.apiKey,
        model: connection.model,
        prompt: user,
        system,
        temperature: settings.temperature,
        maxTokens: 900,
      })
      const parsed = normalizeBookmarkClassificationOutput(parseAIResponse(response.content), {
        url: input.url,
        fallbackTitle: input.title ?? input.url,
        maxTags: settings.tagCount,
      })
      // 复用兜底网按全库归并(不只提示词采样窗口内的 300 个):窗口外命中
      // 大小写变体同样归回规范拼写,草稿展示与保存落库从此一个拼写。
      const fullTagNames = (await db.tags.toArray())
        .filter((tag) => tag.pending_op !== 'delete')
        .map((tag) => tag.name)
      parsed.tags = canonicalizeTagsToExisting(parsed.tags, fullTagNames)
      return { url: input.url, parsed, ok: true }
    } catch (error) {
      return {
        url: input.url,
        parsed: {
          url: input.url,
          title: input.title,
          description: input.description,
          tags: input.tags,
          folderPath: input.folderPath,
        },
        ok: false,
        error: error instanceof Error ? error.message : 'AI classify failed',
      }
    }
  }
}


/**
 * Context the classifier needs to honour the "reuse existing names" contract.
 *
 * Sampling is ranked, not arbitrary: `limit()` without `orderBy` returns rows
 * in primary-key (uuid) order, which is random with respect of usefulness —
 * past a few hundred tags the model would never see the other half of the
 * library and mint near-duplicates of tags it cannot see. Rows are tiny, so
 * reading the table and ranking in memory is cheap:
 *
 * - tags by click_count descending (most-used first), capped at the prompt's
 *   tag-library limit so what is loaded is exactly what the model sees;
 * - folders in full — they are the taxonomy backbone and the basis of the
 *   governance stats, typically well under the cap.
 *
 * tagLibrarySize carries the TRUE library size (the 300-tag candidate window
 * only shows the most-used tail): the prompt's reuse pressure escalates with
 * library size, so it must know how big the library really is.
 */
export async function loadContext(): Promise<{ existingTags: string[]; existingTagContext: ExistingTagContext[]; existingFolders: { name: string; path: string[] }[]; tagLibrarySize: number }> {
  const [tags, folders, tagLibrarySize] = await Promise.all([
    db.tags.orderBy('bookmark_count').reverse().limit(EXISTING_TAGS_PROMPT_LIMIT * 2).toArray(),
    db.folders.toArray(),
    db.tags.count(),
  ])

  const activeTagRows = tags
    .filter((tag) => tag.pending_op !== 'delete')
    .sort((a, b) => {
      const scoreA = (a.bookmark_count ?? 0) * 1000 + (a.click_count ?? 0) * 10 + Date.parse(a.updated_at || '') / 1e9
      const scoreB = (b.bookmark_count ?? 0) * 1000 + (b.click_count ?? 0) * 10 + Date.parse(b.updated_at || '') / 1e9
      return scoreB - scoreA
    })
  const uniqueTagRows = activeTagRows.filter((tag, index, rows) => rows.findIndex((candidate) => candidate.name.toLowerCase() === tag.name.toLowerCase()) === index)
  const existingTagContext: ExistingTagContext[] = uniqueTagRows.slice(0, EXISTING_TAGS_PROMPT_LIMIT).map((tag) => ({
    name: tag.name,
    bookmarkCount: tag.bookmark_count,
    clickCount: tag.click_count,
    updatedAt: tag.updated_at,
  }))
  // 依据现有数据结构构建两级目录路径：folders 有 parent_id，交给
  // buildExistingBookmarkFolderContext 沿 parent_id 上溯并截取最深两级，
  // 让 AI 看到的是「一级 / 二级」路径而非扁平的文件夹名。
  const folderRecords = folders
    .filter((folder) => !folder.deleted_at && folder.pending_op !== 'delete')
    .map((folder) => ({ id: folder.id, name: folder.name, parentId: folder.parent_id ?? null }))
  return {
    existingTags: existingTagContext.map((tag) => tag.name),
    existingTagContext,
    existingFolders: buildExistingBookmarkFolderContext(folderRecords, 2).slice(0, EXISTING_FOLDERS_PROMPT_LIMIT),
    tagLibrarySize,
  }
}
