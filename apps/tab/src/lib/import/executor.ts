import { db as defaultDb } from '../db'
import { buildBookmarkLookupIndex, saveBookmarkLocal } from '../db/bookmarks'
import type { TMarkDB } from '../db'
import { dedupeImportBookmarks, type DuplicatePolicy, type ImportBookmarkDraft } from './types'

interface ImportExecuteOptions {
  duplicatePolicy?: DuplicatePolicy
  onProgress?: (current: number, total: number) => void
  db?: TMarkDB
}

export interface ImportExecuteResult {
  imported: number
  skipped: number
  failed: number
  errors: Array<{ url: string; message: string }>
}

export async function executeImport(
  input: ImportBookmarkDraft[],
  options: ImportExecuteOptions = {},
): Promise<ImportExecuteResult> {
  const db = options.db ?? defaultDb
  const existing = await db.bookmarks.toArray()
  // 墓碑(软删/待删)不算"已存在":删除后的书签靠再次导入取回是标准流程,
  // 把墓碑算重会让这些 URL 永久无法再导入(与 tab-collection 的
  // "墓碑条目不再阻塞重新添加同 URL"同语义;服务端唯一索引也只约束活行)。
  const liveExisting = existing.filter((b) => !b.deleted_at && b.pending_op !== 'delete')
  const deduped = dedupeImportBookmarks(input, liveExisting.map((bookmark) => bookmark.url), options.duplicatePolicy ?? 'skip')
  const drafts = deduped.items
  // R8 TA-3: 预扫一次构建归一化 URL → 活行索引,循环内 O(1) 命中——此前每存
  // 一次都 toArray() 全表反序列化,20k 书签导入 ~2e8 次归一化(执行层复活了
  // types.ts 解析层修掉的冻结)。
  const lookup = buildBookmarkLookupIndex(existing)

  const result: ImportExecuteResult = { imported: 0, skipped: deduped.skipped, failed: 0, errors: [] }
  for (let index = 0; index < drafts.length; index++) {
    const draft = drafts[index]!
    try {
      await saveBookmarkLocal({
        title: draft.title,
        url: draft.url,
        description: draft.description,
        folder_path: draft.folderPath,
        tags: draft.tags,
        existingIndex: lookup,
      })
      result.imported++
    } catch (error) {
      result.failed++
      result.errors.push({ url: draft.url, message: error instanceof Error ? error.message : 'Import failed' })
    }
    options.onProgress?.(index + 1, drafts.length)
  }
  return result
}
