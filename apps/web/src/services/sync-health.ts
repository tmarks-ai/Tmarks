import { apiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'

/** 单个实体的云端汇总：存活行数 + 最近更新时间上界。 */
export interface SyncEntitySummary {
  count: number
  maxUpdatedAt: string | null
}

/**
 * GET /api/v1/sync/summary 的响应体。后端按实体名（key）返回对象 map，
 * 而非数组；并附带待处理变更数、服务器时间与游标上界。
 * 与 backend-core `routes/sync/summary` 的 `success({...})` 结构保持一致。
 */
interface SyncSummary {
  entities: {
    bookmarks: SyncEntitySummary
    bookmark_folders: SyncEntitySummary
    tags: SyncEntitySummary
    tab_groups: SyncEntitySummary
    tab_group_items: SyncEntitySummary
  }
  pendingOperations: number
  serverTime: string
  cursorBound: number
}

export const syncHealthService = {
  async getSummary(): Promise<SyncSummary> {
    return unwrapData(await apiClient.get<SyncSummary>('/sync/summary'), 'GET /sync/summary')
  },
}
