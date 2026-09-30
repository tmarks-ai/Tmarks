/**
 * 统一判活谓词(RC-A):所有软删实体双标墓碑(deleted_at + pending_op='delete')。
 * tags 无 deleted_at 字段(TagDTO 未声明),仅 pending_op='delete' 判墓碑。
 * 替代散落各处的 `!deleted_at && pending_op !== 'delete'` / `pending_op !== 'delete'` 判活过滤,
 * 消除"item 墓碑只设 pending_op 不设 deleted_at 时活跃集与墓碑集重叠"的根因。
 */
import type { SyncOperationType } from '@tmarks/contracts'
import type { LocalBookmark, LocalFolder, LocalTabGroup, LocalTabGroupItem, LocalTag } from './index'

interface LiveRow {
  deleted_at?: string | null
  pending_op: SyncOperationType | null
}

/** 行是否活跃(未软删且未标记删除)。 */
function isLiveRow(row: LiveRow): boolean {
  return row.deleted_at == null && row.pending_op !== 'delete'
}

export const isLiveBookmark = (r: LocalBookmark): boolean => isLiveRow(r)
export const isLiveFolder = (r: LocalFolder): boolean => isLiveRow(r)
export const isLiveTabGroup = (r: LocalTabGroup): boolean => isLiveRow(r)
export const isLiveTabGroupItem = (r: LocalTabGroupItem): boolean => isLiveRow(r)
/** tags 无 deleted_at,仅凭 pending_op 判活。 */
export const isLiveTag = (r: LocalTag): boolean => r.pending_op !== 'delete'
