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

/**
 * Promise-chain mutex slot: the caller takes the slot synchronously (FIFO by
 * call order) and awaits the previous holder before running.
 */
type GateAcquire = () => Promise<() => void>

class SqliteD1Statement {
  /** Parameter properties avoided by convention (see comment on the class below). */
  private readonly db: SqliteDatabase
  private readonly sql: string
  private readonly params: unknown[]
  /** Serializes direct execution against the database's gate (batch() runs raw). */
  private readonly acquire: GateAcquire

  constructor(db: SqliteDatabase, sql: string, params: unknown[] = [], acquire?: GateAcquire) {
    this.db = db
    this.sql = sql
    this.params = params
    this.acquire = acquire ?? (async () => () => {})
    if (params.length > D1_MAX_BOUND_PARAMS) {
      throw new Error(
        `D1 platform limit: ${params.length} bound parameters exceed 100. SQL: ${sql.slice(0, 120)}`,
      )
    }
  }

  bind(...params: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.db, this.sql, params, this.acquire)
  }

  private normalized(): unknown[] {
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
}

export class SqliteD1Database {
  /** Parameter property avoided by convention (see the statement class note). */
  readonly sqlite: SqliteDatabase

  constructor(sqlite: SqliteDatabase) {
    this.sqlite = sqlite
  }

  /**
   * Serializes ALL statements — single and batch. Real D1 runs each single
   * statement as its own implicit transaction and batches atomically
   * server-side; on this shared connection the old gate only covered
   * batch↔batch, so a single-statement write could land inside an in-flight
   * batch's BEGIN..COMMIT window and be swept into its ROLLBACK — silently
   * discarding a write whose caller already got `success` (R8 BL-6).
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
    const release = await this.acquireGate()
    try {
      this.sqlite.exec('BEGIN')
      const results: unknown[] = []
      for (const statement of statements) {
        results.push(statement.rawRun())
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
  // R8 IN-1: D1 enforces foreign keys by default (equivalent to
  // `PRAGMA foreign_keys = on`) — the old OFF made this adapter MORE lenient
  // than production, so constraint violations surfaced only after deploying
  // to Workers. The schema's FKs all carry ON DELETE actions, matching the
  // manual cascades the code already performs.
  sqlite.exec('PRAGMA foreign_keys = ON')

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
