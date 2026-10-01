import { readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

/**
 * Production D1 adapter backed by a persistent SQLite file.
 *
 * Mirrors the D1 platform contract that backend-core codes against:
 * - prepare(sql).bind(...).first()/all()/run()
 * - db.batch(statements) (atomic — SQLite transactions)
 * - Max 100 bound parameters per query (D1 platform limit)
 *
 * Applies migrations from sql/*.sql on startup, tracked in a _migrations
 * ledger table — the same semantics as `wrangler d1 migrations apply --remote`.
 */

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

export interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
  }
  close(): void
}

const D1_MAX_BOUND_PARAMS = 100

class SqliteD1Statement {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {
    if (params.length > D1_MAX_BOUND_PARAMS) {
      throw new Error(
        `D1 platform limit: ${params.length} bound parameters exceed 100. SQL: ${sql.slice(0, 120)}`,
      )
    }
  }

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.db, this.sql, params)
  }

  private normalized(): unknown[] {
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

export class SqliteD1Database {
  constructor(readonly sqlite: SqliteDatabase) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.sqlite, sql)
  }

  async batch(statements: SqliteD1Statement[]): Promise<unknown[]> {
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

/**
 * Create a persistent SQLite-backed D1 database with migrations applied.
 * The file is created if it doesn't exist; migrations are idempotent
 * (tracked in a _migrations ledger, same as wrangler's d1_migrations).
 */
export function createPersistentD1(dbPath: string, migrationsDir: string): SqliteD1Database {
  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const sqlite = new DatabaseSync(resolve(dbPath))
  sqlite.exec('PRAGMA journal_mode = WAL')
  sqlite.exec('PRAGMA foreign_keys = OFF') // matches D1 semantics

  // Migration ledger (same contract as wrangler's d1_migrations table)
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`)

  const applied = new Set(
    (sqlite.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>).map((r) => r.name),
  )

  // Apply pending migrations in lexical order (= numeric prefix order)
  const files = readdirSync(migrationsDir)
    .filter((name: string) => name.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    sqlite.exec('BEGIN')
    try {
      sqlite.exec(sql)
      sqlite.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString())
      sqlite.exec('COMMIT')
      console.log(`[migration] applied ${file}`)
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`)
    }
  }

  return new SqliteD1Database(sqlite)
}
