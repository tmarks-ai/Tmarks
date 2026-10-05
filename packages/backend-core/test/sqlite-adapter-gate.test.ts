import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from './helpers/sqlite-d1'

/**
 * R8 BL-6 回归网:单条语句与批次共用同一个互斥门。真 D1 的单条语句是独立
 * 隐式事务、批量为服务端原子;旧的 batchGate 只互斥 batch↔batch,并发单条写
 * 落进在途批次的 BEGIN..COMMIT 窗口时会被该批次的 ROLLBACK 静默卷走——调用
 * 方早已拿到 success,属于测试无法察觉的数据丢失。
 *
 * 时序契约:batch() 在调用时同步占用门槽(FIFO),批次的 BEGIN..COMMIT 跨
 * 微任务边界;测试在启动批次后让事件循环走一个微任务,确保批次已进入事务
 * 窗口,再发起并发单条写——修复前该写被卷进 ROLLBACK,修复后排在批次之后。
 */
describe('sqlite-d1 statement gate (R8 BL-6)', () => {
  it('a failing batch ROLLBACK does not sweep in a concurrent single-statement write', async () => {
    const harness = createSqliteD1('user-1')
    try {
      harness.sqlite.exec('CREATE TABLE gate_probe (id TEXT PRIMARY KEY)')
      const failingBatch = harness.db.batch([
        harness.db.prepare(`INSERT INTO gate_probe (id) VALUES (?)`).bind('batch-1'),
        harness.db.prepare(`INSERT INTO gate_probe_missing (id) VALUES (?)`).bind('x'),
      ])
      failingBatch.catch(() => {})
      // 一个微任务:让批次越过 BEGIN 进入事务窗口(修复前的可复现窗口)。
      await Promise.resolve()
      const loneWrite = harness.db.prepare(`INSERT INTO gate_probe (id) VALUES (?)`).bind('lone').run()
      await expect(failingBatch).rejects.toThrow()
      await loneWrite
      const row = await harness.db.prepare(`SELECT id FROM gate_probe WHERE id = ?`).bind('lone').first<{ id: string }>()
      expect(row).toEqual({ id: 'lone' })
      const batchRow = await harness.db.prepare(`SELECT id FROM gate_probe WHERE id = ?`).bind('batch-1').first()
      expect(batchRow).toBeNull()
    } finally {
      harness.close()
    }
  })

  it('concurrent batches serialize — the winner commits, the loser rolls back cleanly', async () => {
    const harness = createSqliteD1('user-2')
    try {
      harness.sqlite.exec('CREATE TABLE gate_probe2 (id TEXT PRIMARY KEY)')
      const winner = harness.db.batch([harness.db.prepare(`INSERT INTO gate_probe2 (id) VALUES (?)`).bind('a1')])
      const loser = harness.db.batch([
        harness.db.prepare(`INSERT INTO gate_probe2 (id) VALUES (?)`).bind('b1'),
        harness.db.prepare(`INSERT INTO gate_probe2_missing (id) VALUES (?)`).bind('x'),
      ])
      loser.catch(() => {})
      await winner
      await expect(loser).rejects.toThrow()
      const { results } = await harness.db.prepare(`SELECT id FROM gate_probe2 ORDER BY id`).all<{ id: string }>()
      // winner 的写入不被 loser 的 ROLLBACK 卷走,loser 半途写入不存在。
      expect(results.map((row) => row.id)).toEqual(['a1'])
    } finally {
      harness.close()
    }
  })

  it('sequential single statements are unaffected by the gate', async () => {
    const harness = createSqliteD1('user-3')
    try {
      harness.sqlite.exec('CREATE TABLE gate_probe3 (id TEXT PRIMARY KEY, n INTEGER NOT NULL)')
      for (let i = 0; i < 5; i++) {
        await harness.db.prepare(`INSERT INTO gate_probe3 (id, n) VALUES (?, ?)`).bind(`r${i}`, i).run()
      }
      const total = await harness.db.prepare(`SELECT COUNT(*) AS c FROM gate_probe3`).first<{ c: number }>()
      expect(total?.c).toBe(5)
    } finally {
      harness.close()
    }
  })
})
