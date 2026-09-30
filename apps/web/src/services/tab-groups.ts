import { apiClient } from '@/lib/api-client'
import { unwrapData } from '@/lib/api-response'
import { logger } from '@/lib/logger'
import type {
  AddTabGroupItemsResponse,
  BatchTabGroupItemsInput,
  BatchTabGroupItemsResult,
  BatchUpdatePositionItem,
  CreateTabGroupInput,
  CreateTabGroupItemInput,
  DedupTabGroupInput,
  MoveTabGroupItemInput,
  TabGroupDedupResult,
  TabGroupDTO,
  TabGroupDetailResponse,
  TabGroupItemResponse,
  TabGroupItemDTO,
  TabGroupQueryParams,
  TabGroupTrashResponse,
  TabGroupsResponse,
  UpdateTabGroupInput,
  UpdateTabGroupItemInput,
} from '@tmarks/contracts'

function toTabGroupQuery(params: TabGroupQueryParams = {}): string {
  const sp = new URLSearchParams()
  if (params.page_size) sp.set('page_size', String(params.page_size))
  if (params.page_cursor) sp.set('page_cursor', params.page_cursor)
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export const tabGroupsService = {
  async getTabGroups(params?: TabGroupQueryParams): Promise<TabGroupsResponse> {
    return unwrapData(await apiClient.get<TabGroupsResponse>(`/tab-groups${toTabGroupQuery(params)}`), 'GET /tab-groups')
  },

  async listAllTabGroups(pageSize = 100): Promise<TabGroupDTO[]> {
    const all: TabGroupDTO[] = []
    let cursor: string | undefined
    for (let i = 0; i < 50; i++) {
      const res = await this.getTabGroups({ page_size: pageSize, page_cursor: cursor })
      all.push(...res.tab_groups)
      if (!res.meta.has_more || !res.meta.next_cursor) return all
      cursor = res.meta.next_cursor
    }
    // 安全帽(50 页)防无限循环;正常数据量到不了这里。
    logger.warn('[tab-groups] listAllTabGroups reached the 50-page safety cap; results may be truncated')
    return all
  },

  async getTabGroup(id: string): Promise<TabGroupDTO> {
    return unwrapData(await apiClient.get<TabGroupDetailResponse>(`/tab-groups/${id}`), `GET /tab-groups/${id}`).tab_group
  },
  async getTrash(): Promise<TabGroupTrashResponse> {
    return unwrapData(await apiClient.get<TabGroupTrashResponse>('/tab-groups/trash'), 'GET /tab-groups/trash')
  },
  async createTabGroup(data: CreateTabGroupInput): Promise<TabGroupDTO> {
    return unwrapData(await apiClient.post<TabGroupDetailResponse>('/tab-groups', data), 'POST /tab-groups').tab_group
  },
  async updateTabGroup(id: string, data: UpdateTabGroupInput): Promise<TabGroupDTO> {
    return unwrapData(await apiClient.patch<TabGroupDetailResponse>(`/tab-groups/${id}`, data), `PATCH /tab-groups/${id}`).tab_group
  },
  async deleteTabGroup(id: string): Promise<void> { await apiClient.delete(`/tab-groups/${id}`) },
  async permanentDeleteTabGroup(id: string): Promise<void> { await apiClient.delete(`/tab-groups/${id}/permanent-delete`) },
  async restoreTabGroup(id: string): Promise<void> { await apiClient.post(`/tab-groups/${id}/restore`, {}) },
  async addTabGroupItems(groupId: string, items: CreateTabGroupItemInput[]): Promise<AddTabGroupItemsResponse> {
    return unwrapData(await apiClient.post<AddTabGroupItemsResponse>(`/tab-groups/${groupId}/items/batch`, { items }), `POST /tab-groups/${groupId}/items/batch`)
  },
  async updateTabGroupItem(itemId: string, data: UpdateTabGroupItemInput): Promise<TabGroupItemDTO> {
    return unwrapData(await apiClient.patch<TabGroupItemResponse>(`/tab-groups/items/${itemId}`, data), `PATCH /tab-groups/items/${itemId}`).item
  },
  async deleteTabGroupItem(itemId: string): Promise<void> { await apiClient.delete(`/tab-groups/items/${itemId}`) },
  async moveTabGroupItem(itemId: string, data: MoveTabGroupItemInput): Promise<TabGroupItemDTO> {
    return unwrapData(await apiClient.post<TabGroupItemResponse>(`/tab-groups/items/${itemId}/move`, data), `POST /tab-groups/items/${itemId}/move`).item
  },
  async batchUpdatePositions(updates: BatchUpdatePositionItem[]): Promise<void> {
    await apiClient.patch('/tab-groups/batch-update', { updates })
  },
  async batchTabGroupItems(input: BatchTabGroupItemsInput): Promise<BatchTabGroupItemsResult> {
    return unwrapData(await apiClient.post<BatchTabGroupItemsResult>('/tab-groups/items/batch', input), 'POST /tab-groups/items/batch')
  },
  async dedupTabGroup(groupId: string, data: DedupTabGroupInput = {}): Promise<TabGroupDedupResult> {
    return unwrapData(await apiClient.post<TabGroupDedupResult>(`/tab-groups/${groupId}/dedup`, data), 'POST /tab-groups/:id/dedup')
  },
}
