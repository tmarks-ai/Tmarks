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
    private readonly params: unknown[] = []
  ) {
    if (params.length > D1_MAX_BOUND_PARAMS) {
      throw new Error(
        `D1 platform limit violated: ${params.length} bound parameters exceed the maximum of ${D1_MAX_BOUND_PARAMS} per query. Chunk the IN (...) expansion. SQL: ${sql.slice(0, 120)}`,
      )
    }
  }

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.db, this.sql, params)
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

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.normalized())
    return (row as T) ?? null
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    const rows = this.db.prepare(this.sql).all(...this.normalized())
    return { results: rows as T[], success: true }
  }

  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
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
}

class SqliteD1Database {
  constructor(readonly sqlite: SqliteDatabase) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.sqlite, sql)
  }

  async batch(statements: SqliteD1Statement[]): Promise<unknown[]> {
    // D1 batches are atomic; mirror that so a failing statement cannot leave
    // half a batch applied and mask ordering bugs.
    this.sqlite.exec('BEGIN')
    try {
      const results: unknown[] = []
      for (const statement of statements) {
        results.push(await statement.run())
      }
      this.sqlite.exec('COMMIT')
      return results
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
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
