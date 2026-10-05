import { describe, expect, it } from 'vitest'
import { recoverIdempotencyAfterFailure } from '../src/lib/sync/sync-recovery'
import { buildStoreStatement, claimIdempotency } from '../src/lib/sync/sync-idempotency'
import type { SyncEnvelope } from '@tmarks/contracts'
import { createSqliteD1 } from './helpers/sqlite-d1'

/**
 * R8 BT-3 回归网:push 中途崩溃的恢复语义此前零覆盖——而其自注释明言"两侧
 * 任错即数据 bug":已落地的操作必须保留响应(释放会让重试重复施加副作用),
 * 未运行的操作必须释放占位(否则以 IDEMPOTENCY_IN_PROGRESS 楔死 14 天)。
 */
const USER = 'user-1'

function envelope(opId: string): SyncEnvelope {
  return {
    client_operation_id: opId,
    device_id: 'device-a',
    entity_type: 'bookmark',
    entity_id: `bm-${opId}`,
    operation: 'upsert',
    base_revision: null,
    payload: { title: 'T', url: `https://example.com/${opId}` },
    created_at: new Date().toISOString(),
  } as SyncEnvelope
}

async function seedPlaceholder(h: ReturnType<typeof createSqliteD1>, opId: string, requestHash: string) {
  await h.sqlite
    .prepare(
      `INSERT INTO sync_idempotency_keys (user_id, client_operation_id, request_hash, response_json, expires_at)
       VALUES (?, ?, ?, '', ?)`,
    )
    .run(USER, opId, requestHash, new Date(Date.now() + 14 * 24 * 3600_000).toISOString())
}

function rowFor(h: ReturnType<typeof createSqliteD1>, opId: string) {
  return h.sqlite
    .prepare(`SELECT response_json FROM sync_idempotency_keys WHERE user_id = ? AND client_operation_id = ?`)
    .get(USER, opId) as { response_json: string } | undefined
}

describe('recoverIdempotencyAfterFailure (R8 BT-3)', () => {
  it('keeps the stored response for settled operations and releases unsettled placeholders', async () => {
    const h = createSqliteD1(USER)
    try {
      await seedPlaceholder(h, 'op-settled', 'hash-a')
      await seedPlaceholder(h, 'op-never-ran', 'hash-b')

      const claims = [
        { kind: 'apply', operation: envelope('op-settled'), requestHash: 'hash-a' },
        { kind: 'apply', operation: envelope('op-never-ran'), requestHash: 'hash-b' },
      ] as Parameters<typeof recoverIdempotencyAfterFailure>[2]
      const settled = new Set(['op-settled'])
      const storeStatements = [
        buildStoreStatement(h.db, USER, 'op-settled', 'hash-a', { type: 'accepted', value: { client_operation_id: 'op-settled' } }),
      ]

      await recoverIdempotencyAfterFailure(h.db, USER, claims, settled, storeStatements)

      // 已落地:响应被写入(重放返回存储结果,绝不重复施加)。
      const settledRow = rowFor(h, 'op-settled')
      expect(settledRow?.response_json).toContain('"accepted"')
      // 未运行:占位被删,可重试(claim 直接拿到 changes=1 的新占位)。
      expect(rowFor(h, 'op-never-ran')).toBeUndefined()
      const reclaimed = await claimIdempotency(h.db, USER, envelope('op-never-ran'))
      expect(reclaimed.kind).toBe('apply')
    } finally {
      h.close()
    }
  })

  it('an all-settled failure only persists responses — no placeholder is released', async () => {
    const h = createSqliteD1(USER)
    try {
      await seedPlaceholder(h, 'op-x', 'hash-x')
      const claims = [{ kind: 'apply', operation: envelope('op-x'), requestHash: 'hash-x' }] as Parameters<typeof recoverIdempotencyAfterFailure>[2]
      const storeStatements = [
        buildStoreStatement(h.db, USER, 'op-x', 'hash-x', { type: 'rejected', value: { client_operation_id: 'op-x' } }),
      ]

      await recoverIdempotencyAfterFailure(h.db, USER, claims, new Set(['op-x']), storeStatements)

      expect(rowFor(h, 'op-x')?.response_json).toContain('"rejected"')
    } finally {
      h.close()
    }
  })

  it('replay/mismatch claims are never released (they carry nothing to roll back)', async () => {
    const h = createSqliteD1(USER)
    try {
      await seedPlaceholder(h, 'op-r', 'hash-r')
      const claims = [
        { kind: 'replay', response: { type: 'rejected', value: { client_operation_id: 'op-r' } } },
        { kind: 'mismatch', operation: envelope('op-r') },
      ] as unknown as Parameters<typeof recoverIdempotencyAfterFailure>[2]

      await recoverIdempotencyAfterFailure(h.db, USER, claims, new Set(), [])

      // 回放/失配路径从未写入该占位,response_json='' 的谓词删不到别人的行。
      expect(rowFor(h, 'op-r')).toBeDefined()
    } finally {
      h.close()
    }
  })
})
