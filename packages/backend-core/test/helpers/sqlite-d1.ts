import { createMigratedDatabase, type SqliteDatabase } from './sqlite-migrations'

/**
 * A D1Database implementation backed by real SQLite.
 *
 * The hand-written in-memory harness (sync-d1-memory.ts) re-implements SQL
 * semantics in TypeScript, so it cannot catch bugs that live in the SQL itself —
 * an `ON CONFLICT` clause targeting the wrong columns, a constraint violation,
 * an unbalanced paren. This adapter runs the statements the production code
 * actually emits against the schema the migrations actually produce.
 */
/**
 * D1 platform limit: at most 100 bound parameters per query
 * (https://developers.cloudflare.com/d1/platform/limits/). Local SQLite's
 * limit is 999/32k, so without this guard a query that would 500 in
 * production (e.g. `IN (?)` × 100 + 1 fixed param) passes tests green —
 * the R5-1 audit proved this live with a 100-id bulk request.
 */
const D1_MAX_BOUND_PARAMS = 100

class SqliteD1Statement {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly sql: string,
    private readonly params: unknown[] = [],
    private readonly acquire: () => Promise<() => void> = async () => () => {},
  ) {
    if (params.length > D1_MAX_BOUND_PARAMS) {
      throw new Error(
        `D1 platform limit violated: ${params.length} bound parameters exceed the maximum of ${D1_MAX_BOUND_PARAMS} per query. Chunk the IN (...) expansion. SQL: ${sql.slice(0, 120)}`,
      )
    }
  }

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.db, this.sql, params, this.acquire)
  }

  private normalized(): unknown[] {
    // node:sqlite accepts null/number/bigint/string/Uint8Array only; booleans
    // and undefined arrive from payload spreads and must be coerced.
    return this.params.map((param) => {
      if (param === undefined) return null
      if (typeof param === 'boolean') return param ? 1 : 0
      return param
    })
  }

  private async gated<T>(fn: () => T): Promise<T> {
    const release = await this.acquire()
    try {
      return fn()
    } finally {
      release()
    }
  }

  /** Gate-free executors — batch() runs these inside its own held gate. */
  rawFirst<T = Record<string, unknown>>(): T | null {
    const row = this.db.prepare(this.sql).get(...this.normalized())
    return (row as T) ?? null
  }

  rawAll<T = Record<string, unknown>>(): { results: T[]; success: true } {
    const rows = this.db.prepare(this.sql).all(...this.normalized())
    return { results: rows as T[], success: true }
  }

  rawRun(): { success: true; meta: { changes: number; last_row_id: number } } {
    // `meta.changes` is load-bearing: the idempotency claim uses it to tell an
    // insert that landed from one that hit ON CONFLICT DO NOTHING.
    const result = this.db.prepare(this.sql).run(...this.normalized()) as {
      changes?: number | bigint
      lastInsertRowid?: number | bigint
    }
    return {
      success: true,
      meta: {
        changes: Number(result?.changes ?? 0),
        last_row_id: Number(result?.lastInsertRowid ?? 0),
      },
    }
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return this.gated(() => this.rawFirst<T>())
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    return this.gated(() => this.rawAll<T>())
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    return this.gated(() => this.rawRun())
  }

  /**
   * Raw batch executor (R8 BT-1): real D1 batches return a D1Result per
   * statement, and SELECT-like statements carry their rows in `.results` —
   * the sync summary route reads `result?.results?.[0]`. The old harness ran
   * every batched statement through rawRun(), dropping SELECT rows, so the
   * summary route's SQL could only be "tested" through the memory mock that
   * re-implements its aggregation in TypeScript.
   */
  rawExecute(): unknown {
    if (/^\s*(SELECT|WITH)\b/i.test(this.sql)) return this.rawAll()
    return this.rawRun()
  }
}

class SqliteD1Database {
  constructor(readonly sqlite: SqliteDatabase) {}

  /**
   * Serializes ALL statements — single and batch — mirroring apps/server's
   * adapter. Real D1 runs each single statement as its own implicit
   * transaction and batches atomically server-side; the old gate only
   * covered batch↔batch, so a concurrent single-statement write landing
   * inside an in-flight batch's BEGIN..COMMIT window was swept into its
   * ROLLBACK — the caller already had `success`, so that is silent data
   * loss the tests would never catch (R8 BL-6).
   */
  private opGate: Promise<void> = Promise.resolve()

  private acquireGate(): Promise<() => void> {
    const prev = this.opGate
    let release!: () => void
    this.opGate = new Promise<void>((resolve) => {
      release = resolve
    })
    return prev.then(() => release)
  }

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.sqlite, sql, [], this.acquireGate.bind(this))
  }

  async batch(statements: SqliteD1Statement[]): Promise<unknown[]> {
    // D1 batches are atomic; mirror that so a failing statement cannot leave
    // half a batch applied and mask ordering bugs. Statements run gate-free
    // (rawExecute) inside this one held gate.
    const release = await this.acquireGate()
    try {
      this.sqlite.exec('BEGIN')
      const results: unknown[] = []
      for (const statement of statements) {
        results.push(statement.rawExecute())
      }
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    } finally {
      release()
    }
  }
}

export interface SqliteD1Harness {
  db: D1Database
  sqlite: SqliteDatabase
  close(): void
}

/** Fresh migrated database exposed through the D1 interface, seeded with a user. */
export function createSqliteD1(userId = 'user-1'): SqliteD1Harness {
  const sqlite = createMigratedDatabase()
  sqlite
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(userId, `user-${userId}`, 'x')

  const database = new SqliteD1Database(sqlite)
  return {
    db: database as unknown as D1Database,
    sqlite,
    close: () => sqlite.close(),
  }
}
