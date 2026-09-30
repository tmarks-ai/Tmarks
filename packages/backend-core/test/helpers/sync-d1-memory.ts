import type { SyncEntityType, SyncOperationType } from '@tmarks/contracts'
import type {
  SyncBookmarkFolderRow,
  SyncBookmarkRow,
  SyncBookmarkTagRow,
  SyncChangeRow,
  SyncEntityRevisionRow,
  SyncIdempotencyRow,
  SyncTabGroupItemRow,
  SyncTabGroupRow,
  SyncTagRow,
} from './sync-d1-types'
import { entityRevisionKey, idempotencyKey, normalizeSql, nullableString, pick, removeWhere } from './sync-d1-utils'
import { SyncMemoryD1Statement } from './sync-d1-statement'
import { handleSummaryAggregates } from './sync-d1-memory-summary'
import { claimIdempotency, insertIdempotency } from './sync-d1-memory-idempotency'

export class SyncMemoryD1Database {
  readonly bookmarks = new Map<string, SyncBookmarkRow>()
  readonly tags = new Map<string, SyncTagRow>()
  readonly bookmarkFolders = new Map<string, SyncBookmarkFolderRow>()
  readonly tabGroups = new Map<string, SyncTabGroupRow>()
  readonly tabGroupItems = new Map<string, SyncTabGroupItemRow>()
  readonly bookmarkTags: SyncBookmarkTagRow[] = []
  readonly syncChanges: SyncChangeRow[] = []
  readonly syncDevices = new Map<string, { id: string; user_id: string; last_seen_at: string }>()
  readonly idempotency = new Map<string, SyncIdempotencyRow>()
  readonly entityRevisions = new Map<string, SyncEntityRevisionRow>()

  private nextSyncChangeId = 1

  prepare(sql: string) {
    return new SyncMemoryD1Statement(this, sql)
  }

  async batch(statements: SyncMemoryD1Statement[]) {
    return Promise.all(
      statements.map((statement) => {
        const sql = normalizeSql(statement.sql)
        // Route SELECT statements to all() (returns rows) and everything
        // else (INSERT/UPDATE/DELETE) to run() (applies side effects).
        if (sql.startsWith('select')) {
          return statement.all()
        }
        return statement.run()
      }),
    )
  }

  first(sql: string, values: unknown[]) {
    const normalizedSql = normalizeSql(sql)

    if (normalizedSql.startsWith('select coalesce(max(id), 0) as id from sync_changes')) {
      const userId = String(values[0])
      const maxId = this.syncChanges
        .filter((change) => change.user_id === userId)
        .reduce((max, change) => Math.max(max, change.id), 0)
      return { id: maxId }
    }

    if (normalizedSql.includes('from sync_idempotency_keys')) {
      const key = idempotencyKey(String(values[0]), String(values[1]))
      return this.idempotency.get(key) ?? null
    }

    if (normalizedSql.startsWith('select id, revision, deleted_at from bookmarks where id = ?')) {
      const bookmark = this.bookmarks.get(String(values[0]))
      if (!bookmark || bookmark.user_id !== values[1]) return null
      return pick(bookmark, ['id', 'revision', 'deleted_at'])
    }

    if (normalizedSql.startsWith('select id, revision, deleted_at from bookmarks where user_id = ?')) {
      const userId = String(values[0])
      const url = String(values[1])
      const bookmark = Array.from(this.bookmarks.values()).find(
        (row) => row.user_id === userId && row.url === url,
      )
      return bookmark ? pick(bookmark, ['id', 'revision', 'deleted_at']) : null
    }

    if (normalizedSql.startsWith('select id from tags where id = ?')) {
      const tag = this.tags.get(String(values[0]))
      if (!tag || tag.user_id !== values[1] || tag.deleted_at) return null
      return { id: tag.id }
    }

    if (normalizedSql.startsWith('select id from tags where user_id = ? and name = ?')) {
      const userId = String(values[0])
      const tagName = String(values[1])
      const tag = Array.from(this.tags.values()).find(
        (row) => row.user_id === userId && row.name === tagName,
      )
      return tag ? { id: tag.id } : null
    }

    if (normalizedSql.includes('from sync_entity_revisions')) {
      const key = entityRevisionKey(String(values[0]), String(values[1]), String(values[2]))
      return this.entityRevisions.get(key) ?? null
    }

    if (normalizedSql.includes('from bookmarks') && normalizedSql.includes('where id = ? and user_id = ?')) {
      const bookmark = this.bookmarks.get(String(values[0]))
      return bookmark && bookmark.user_id === values[1] ? { ...bookmark } : null
    }

    return null
  }

  all<T>(sql: string, values: unknown[]) {
    const normalizedSql = normalizeSql(sql)

    if (normalizedSql.startsWith('select count(id) as pending from sync_changes')) {
      const userId = String(values[0])
      // When afterId is null (no cursor) the real D1 evaluates `id > NULL` as
      // false for all rows, yielding 0 pending. The harness must match that
      // instead of coercing null to 0 (which counts every row).
      const afterId = values[1] === null || values[1] === undefined ? null : Number(values[1])
      const pending = afterId === null ? 0 : this.syncChanges.filter((change) => change.user_id === userId && change.id > afterId).length
      return { results: [{ pending } as unknown as T], success: true }
    }

    if (normalizedSql.includes('from sync_changes') && normalizedSql.includes('id > ?')) {
      const userId = String(values[0])
      const afterId = Number(values[1])
      const limit = Number(values[2])
      const results = this.syncChanges
        .filter((change) => change.user_id === userId && change.id > afterId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
        .map((change) => ({ ...change }))
      return { results: results as T[], success: true }
    }

    if (normalizedSql.includes('from tags t join bookmark_tags bt')) {
      const bookmarkId = String(values[0])
      const userId = String(values[1])
      const results = this.bookmarkTags
        .filter((link) => link.bookmark_id === bookmarkId && link.user_id === userId)
        .map((link) => this.tags.get(link.tag_id))
        .filter((tag): tag is SyncTagRow => Boolean(tag) && !tag.deleted_at)
        .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }))
        .sort((a, b) => a.name.localeCompare(b.name)) as T[]
      return { results, success: true }
    }

    // Sync summary aggregates extracted to a sibling helper for the 300-line cap.
    const summary = handleSummaryAggregates<T>(this, sql, values)
    if (summary) return summary

    return { results: [] as T[], success: true }
  }

  run(sql: string, values: unknown[]) {
    const normalizedSql = normalizeSql(sql)
    // Upsert shapes, 'do update' only (the claim is INSERT..ON CONFLICT DO NOTHING with '' placeholder).
    const isIdempotencyUpsert =
      normalizedSql.startsWith('insert or replace into sync_idempotency_keys') ||
      (normalizedSql.startsWith('insert into sync_idempotency_keys') && normalizedSql.includes('do update'))
    if (isIdempotencyUpsert) {
      return insertIdempotency(this.idempotency, values)
    }
    if (normalizedSql.startsWith('insert into sync_idempotency_keys') && normalizedSql.includes('do nothing')) {
      return claimIdempotency(this.idempotency, values)
    }
    if (normalizedSql.startsWith('insert into sync_devices')) return this.insertSyncDevice(values)
    if (normalizedSql.startsWith('insert into bookmarks')) return this.upsertBookmark(values)
    if (normalizedSql.startsWith('update bookmarks set deleted_at = ?')) return this.deleteBookmark(values)
    if (normalizedSql.startsWith('update tags set deleted_at = null')) return this.restoreTag(values)
    if (normalizedSql.startsWith('insert into tags')) return this.upsertTag(values)
    if (normalizedSql.startsWith('delete from bookmark_tags')) return this.deleteBookmarkTags(values)
    if (normalizedSql.startsWith('insert or ignore into bookmark_tags')) return this.insertBookmarkTag(values)
    if (normalizedSql.startsWith('insert into sync_entity_revisions')) return this.insertEntityRevision(values)
    if (normalizedSql.startsWith('insert into sync_changes')) return this.insertSyncChange(values)
    return { success: true }
  }

  private insertSyncDevice(values: unknown[]) {
    const id = String(values[0])
    const userId = String(values[1])
    this.syncDevices.set(`${userId}:${id}`, { id, user_id: userId, last_seen_at: new Date().toISOString() })
    return { success: true }
  }

  private upsertBookmark(values: unknown[]) {
    const [id, userId, title, url, normalizedUrl, description, folderId, coverImage, favicon, isPinned, pinOrder, revision, createdAt, updatedAt] = values
    const existingByUrl = Array.from(this.bookmarks.values()).find((bookmark) => bookmark.user_id === userId && bookmark.url === url)
    const targetId = existingByUrl?.id ?? String(id)
    this.bookmarks.set(targetId, {
      id: targetId,
      user_id: String(userId),
      title: String(title),
      url: String(url),
      normalized_url: nullableString(normalizedUrl),
      description: nullableString(description),
      folder_id: nullableString(folderId),
      cover_image: nullableString(coverImage),
      favicon: nullableString(favicon),
      is_pinned: Number(isPinned),
      pin_order: Number(pinOrder),
      click_count: existingByUrl?.click_count ?? 0,
      last_clicked_at: existingByUrl?.last_clicked_at ?? null,
      revision: String(revision),
      created_at: existingByUrl?.created_at ?? String(createdAt),
      updated_at: String(updatedAt),
      deleted_at: null,
    })
    return { success: true }
  }

  private deleteBookmark(values: unknown[]) {
    const bookmark = this.bookmarks.get(String(values[3]))
    if (bookmark && bookmark.user_id === values[4]) {
      bookmark.deleted_at = String(values[0])
      bookmark.revision = String(values[1])
      bookmark.updated_at = String(values[2])
    }
    return { success: true }
  }

  private restoreTag(values: unknown[]) {
    const tag = this.tags.get(String(values[1]))
    if (tag && tag.user_id === values[2]) {
      tag.deleted_at = null
      tag.updated_at = String(values[0])
    }
    return { success: true }
  }

  private upsertTag(values: unknown[]) {
    const [id, userId, name, colorOrCreatedAt, createdOrUpdatedAt, maybeUpdatedAt] = values
    const existing = Array.from(this.tags.values()).find((tag) => tag.user_id === userId && tag.name === name)
    const color = values.length === 6 ? nullableString(colorOrCreatedAt) : null
    const createdAt = values.length === 6 ? String(createdOrUpdatedAt) : String(colorOrCreatedAt)
    const updatedAt = values.length === 6 ? String(maybeUpdatedAt) : String(createdOrUpdatedAt)
    const targetId = existing?.id ?? String(id)

    this.tags.set(targetId, {
      id: targetId,
      user_id: String(userId),
      name: String(name),
      color,
      click_count: existing?.click_count ?? 0,
      last_clicked_at: existing?.last_clicked_at ?? null,
      created_at: existing?.created_at ?? createdAt,
      updated_at: updatedAt,
      deleted_at: null,
    })
    return { success: true }
  }

  private deleteBookmarkTags(values: unknown[]) {
    const bookmarkId = String(values[0])
    const userId = String(values[1])
    removeWhere(this.bookmarkTags, (link) => link.bookmark_id === bookmarkId && link.user_id === userId)
    return { success: true }
  }

  private insertBookmarkTag(values: unknown[]) {
    const row: SyncBookmarkTagRow = {
      bookmark_id: String(values[0]),
      tag_id: String(values[1]),
      user_id: String(values[2]),
      created_at: String(values[3]),
    }
    const exists = this.bookmarkTags.some((link) => link.bookmark_id === row.bookmark_id && link.tag_id === row.tag_id)
    if (!exists) this.bookmarkTags.push(row)
    return { success: true }
  }

  private insertEntityRevision(values: unknown[]) {
    const row: SyncEntityRevisionRow = {
      user_id: String(values[0]),
      entity_type: String(values[1]) as SyncEntityType,
      entity_id: String(values[2]),
      revision: String(values[3]),
      updated_at: String(values[4]),
    }
    this.entityRevisions.set(entityRevisionKey(row.user_id, row.entity_type, row.entity_id), row)
    return { success: true }
  }

  private insertSyncChange(values: unknown[]) {
    const row: SyncChangeRow = {
      id: this.nextSyncChangeId++,
      change_id: String(values[0]),
      user_id: String(values[1]),
      device_id: String(values[2]),
      entity_type: String(values[3]) as SyncEntityType,
      entity_id: String(values[4]),
      operation: String(values[5]) as SyncOperationType,
      revision: String(values[6]),
      payload_json: nullableString(values[7]),
      changed_at: String(values[8]),
    }
    this.syncChanges.push(row)
    return { success: true }
  }
}
