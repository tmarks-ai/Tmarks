import { db, type OperationLogStatus, type OperationLogRecord } from './index'
import type { EntityId, SyncOperationType } from '@tmarks/contracts'

type EntityType = 'tab_group' | 'tab_group_item' | 'bookmark' | 'bookmark_folder' | 'tag'

/** 写一条本地操作审计日志。每次本地写(书签/文件夹/标签/标签组)记一条,供冲突审查面板展示。 */
export async function logOperation(input: {
  entity_type: EntityType
  entity_id: EntityId
  operation: SyncOperationType
  status?: OperationLogStatus
  detail?: string | null
}): Promise<void> {
  try {
    const record: OperationLogRecord = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      operation: input.operation,
      status: input.status ?? 'ok',
      detail: input.detail ?? null,
    }
    await db.operationLogs.add(record)
    // 保留最近 200 条,超出删除最旧。
    const count = await db.operationLogs.count()
    if (count > 200) {
      const oldest = await db.operationLogs.orderBy('created_at').limit(count - 200).primaryKeys()
      await db.operationLogs.bulkDelete(oldest)
    }
  } catch (error) {
    console.warn('[TMark] operation log write skipped:', error)
  }
}
