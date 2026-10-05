import type {
  Revision,
  SyncChange,
  SyncCursor,
  SyncEntityType,
  SyncEnvelope,
  SyncOperationType,
  SyncRejectedOperation,
} from '@tmarks/contracts'
import { generateUUID } from '../crypto'
import type {
  BookmarkFolderSyncPayload,
  BookmarkSyncPayload,
  PreferenceSyncPayload,
  SyncChangeRow,
  SyncEntityRow,
  TabGroupSyncPayload,
  TagSyncPayload,
} from './sync-types'

export function encodeCursor(id: number): SyncCursor {
  return btoa(JSON.stringify({ v: 1, id }))
}

export function decodeCursor(cursor: string | null): number {
  if (!cursor) {
    return 0
  }

  try {
    const parsed = JSON.parse(atob(cursor)) as { v?: number; id?: number }
    if (parsed.v === 1 && typeof parsed.id === 'number' && Number.isInteger(parsed.id) && parsed.id >= 0) {
      return parsed.id
    }
  } catch {
    return 0
  }

  return 0
}

export function entityRowToBootstrapChange(entityType: SyncEntityType, row: Record<string, unknown>): SyncChange {
  // R8 BL-3: emit the entity's REAL tracked revision — or null when the row
  // predates revision tracking (client treats null as last-write-wins). The
  // old fallback synthesized `rev_<Date.now()>` for every folder/tag/
  // tab_group_item snapshot row, so any bootstrap→edit→push cycle compared
  // the synthetic value against the real registry revision and produced a
  // guaranteed false conflict (local restore, queue-repair loops, API-key
  // sync clients).
  const revision: Revision | null = typeof row.revision === 'string' && row.revision
    ? row.revision
    : 'revision' in row
      ? (row.revision as Revision | null | undefined) ?? null
      : createRevision(String(row.updated_at ?? row.created_at ?? ''))

  return {
    change_id: `bootstrap:${entityType}:${String(row.id)}`,
    cursor: 'bootstrap',
    entity_type: entityType,
    entity_id: String(row.id),
    operation: isBootstrapRowDeleted(row) ? 'delete' : 'upsert',
    revision,
    payload: row,
    changed_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  }
}

export function rowToChange(row: SyncChangeRow): SyncChange {
  return {
    change_id: row.change_id,
    cursor: encodeCursor(row.id),
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    operation: row.operation,
    revision: row.revision,
    payload: row.payload_json ? JSON.parse(row.payload_json) : null,
    changed_at: row.changed_at,
  }
}

export function validateBookmarkPayload(payload: BookmarkSyncPayload, operation: SyncOperationType): string | null {
  if (operation === 'delete') {
    return null
  }
  if (!payload || typeof payload.title !== 'string' || payload.title.trim() === '') {
    return 'Bookmark title is required.'
  }
  if (!payload.url || typeof payload.url !== 'string') {
    return 'Bookmark URL is required.'
  }
  try {
    const url = new URL(payload.url)
    if (!['http:', 'https:'].includes(url.protocol)) {
      return 'Only http and https URLs can be synced.'
    }
  } catch {
    return 'Bookmark URL is invalid.'
  }
  // Array-count caps: per-item text is clamped, but the arrays fed IN(...)
  // reads (tag resolution) and D1 batches (tag links) were unbounded — 8MB
  // of tag names could mint hundreds of chunked queries. 99 keeps every
  // tag-resolution read single-chunk and aligns with the REST storage cap.
  if (Array.isArray(payload.tag_ids) && payload.tag_ids.length > 99) {
    return 'Too many tag ids in one bookmark operation (max 99).'
  }
  if (Array.isArray(payload.tag_names) && payload.tag_names.length > 99) {
    return 'Too many tag names in one bookmark operation (max 99).'
  }
  return null
}

export function validateBookmarkFolderPayload(payload: BookmarkFolderSyncPayload, operation: SyncOperationType): string | null {
  if (operation === 'delete') return null
  if (!payload || typeof payload.name !== 'string' || payload.name.trim() === '') {
    return 'Bookmark folder name is required.'
  }
  return null
}

export function validateTagPayload(payload: TagSyncPayload, operation: SyncOperationType): string | null {
  if (operation === 'delete') return null
  if (!payload || typeof payload.name !== 'string' || payload.name.trim() === '') {
    return 'Tag name is required.'
  }
  if (payload.name.length > 64) {
    return 'Tag name is too long.'
  }
  return null
}

export function validateTabGroupPayload(payload: TabGroupSyncPayload, operation: SyncOperationType): string | null {
  if (operation === 'delete') {
    return null
  }
  if (!payload || typeof payload.title !== 'string' || payload.title.trim() === '') {
    return 'Tab group title is required.'
  }
  if (payload.tabs && !Array.isArray(payload.tabs)) {
    return 'Tab group tabs must be an array.'
  }
  // The tabs array becomes one INSERT statement per item inside a single D1
  // batch: an 8MB push could carry thousands of tabs into a 30s-max batch.
  // 200 aligns with the REST create plane's cap.
  if (Array.isArray(payload.tabs) && payload.tabs.length > 200) {
    return 'Too many tabs in one tab group operation (max 200).'
  }
  return null
}

export function reject(operation: SyncEnvelope, code: string, message: string): SyncRejectedOperation {
  return {
    client_operation_id: operation.client_operation_id,
    entity_type: operation.entity_type,
    entity_id: operation.entity_id,
    code,
    message,
  }
}

export function isSupportedEntity(entityType: SyncEntityType): boolean {
  return (
    entityType === 'bookmark' ||
    entityType === 'bookmark_folder' ||
    entityType === 'tag' ||
    entityType === 'tab_group' ||
    entityType === 'tab_group_item' ||
    entityType === 'preference'
  )
}

export function isSupportedOperation(operation: SyncOperationType): boolean {
  return operation === 'upsert' || operation === 'delete' || operation === 'restore'
}

export function isEntityDeleted(row: SyncEntityRow): boolean {
  return Boolean(row.deleted_at) || row.is_deleted === 1
}

export function createRevision(seed = ''): string {
  return `rev_${Date.now().toString(36)}_${seed ? stableHash(seed).slice(0, 8) : generateUUID().slice(0, 8)}`
}

export function toBooleanInt(value: boolean | number | undefined): number {
  return value === true || value === 1 ? 1 : 0
}

const PREFERENCE_ENUMS: Record<string, readonly string[]> = {
  theme: ['light', 'dark', 'system'],
  view_mode: ['card', 'minimal'],
  density: ['compact', 'normal', 'comfortable'],
  tag_layout: ['grid', 'masonry'],
  sort_by: ['created', 'updated', 'popular'],
  bookmark_nav_mode: ['folders', 'tags'],
  bookmark_aux_panel: ['right', 'drawer', 'hidden'],
  default_bookmark_icon: ['orbital-spinner'],
}
const PREFERENCE_RANGES: Record<string, readonly [number, number]> = {
  page_size: [10, 200],
  search_auto_clear_seconds: [5, 120],
  tag_selection_auto_clear_seconds: [10, 300],
}
const PREFERENCE_BOOLEANS = new Set(['enable_search_auto_clear', 'enable_tag_selection_auto_clear'])

function isAllowedPreferenceValue(key: string, value: string | number): boolean {
  if (key in PREFERENCE_ENUMS) {
    return typeof value === 'string' && (PREFERENCE_ENUMS[key] as readonly string[]).includes(value)
  }
  if (key in PREFERENCE_RANGES) {
    const [min, max] = PREFERENCE_RANGES[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  }
  return false
}

export function normalizePreferencePayload(payload: PreferenceSyncPayload): Record<string, string | number> {
  const allowedKeys = new Set([
    'theme',
    'page_size',
    'view_mode',
    'density',
    'tag_layout',
    'sort_by',
    'search_auto_clear_seconds',
    'tag_selection_auto_clear_seconds',
    'enable_search_auto_clear',
    'enable_tag_selection_auto_clear',
    'default_bookmark_icon',
    'bookmark_nav_mode',
    'bookmark_aux_panel',
  ])

  const normalized: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(payload || {})) {
    if (!allowedKeys.has(key)) continue
    if (PREFERENCE_BOOLEANS.has(key)) {
      if (typeof value === 'boolean') normalized[key] = value ? 1 : 0
      continue
    }
    if (typeof value === 'string' || typeof value === 'number') {
      // 与 REST 偏好校验同口径:枚举/数值范围不符的值直接丢弃,避免同步绕过校验。
      if (isAllowedPreferenceValue(key, value)) normalized[key] = value
    }
  }
  return normalized
}

export async function hashOperation(operation: SyncEnvelope): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(operation))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function uniqueStrings(values?: string[]): string[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) continue
    seen.add(key)
    result.push(normalized.slice(0, 64))
  }

  return result
}

/**
 * Clamp an arbitrary sync-payload text field to the REST plane's storage caps.
 * The REST routes run sanitizeString(title, 500)/url, 2000/description, 1000
 * before persisting; the sync push plane skipped this, so an API-key client
 * could store unbounded strings — amplified by the full-payload snapshot kept
 * in sync_changes.payload_json.
 */
export function clampText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function isBootstrapRowDeleted(row: Record<string, unknown>): boolean {
  return Boolean(row.deleted_at) || row.is_deleted === 1
}

function stableHash(input: string): string {
  let hash = 0
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(16)
}
