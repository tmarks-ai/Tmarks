import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

/** Minimal surface of `node:sqlite`'s DatabaseSync that the harness relies on. */
export interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
    get(...params: unknown[]): unknown
  }
  close(): void
}

// Vite 5 does not know `node:sqlite` (it postdates the bundled builtin list) and
// tries to resolve it from disk. Loading it through createRequire at runtime
// keeps it out of Vite's static module graph.
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase
}

/** D1 migrations directory: sql/, the numbered domain files (see sql/README.md). */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../sql')

/** Migration files in lexical order, which matches their numeric prefix order. */
export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

/**
 * A database in the pre-migration state: in-memory, foreign keys off (D1
 * does not enable them). Kept for the upgrade-path tests that future
 * append migrations (08_*.sql …) will need — they seed data into a partial
 * migration state, then apply the rest.
 */
export function createBareDatabase(): SqliteDatabase {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF')
  return db
}

/** Applies SQL files by absolute path, in the given order. */
export function applySqlFilePaths(db: SqliteDatabase, paths: string[]): void {
  for (const path of paths) {
    const sql = readFileSync(path, 'utf8')
    try {
      db.exec(sql)
    } catch (error) {
      throw new Error(`sql file ${path} failed to apply: ${(error as Error).message}`)
    }
  }
}

/** Applies the named migration files (as returned by listMigrationFiles) in order. */
export function applyMigrationFiles(db: SqliteDatabase, files: string[]): void {
  applySqlFilePaths(db, files.map((file) => join(MIGRATIONS_DIR, file)))
}

/**
 * Applies every migration file, in numeric order, to a fresh in-memory
 * SQLite database.
 *
 * D1 is SQLite, so this is the closest thing to production schema available in
 * a unit test — it catches both migration breakage and query syntax errors that
 * string-matching assertions cannot (see the pin-order pagination regression).
 *
 * Foreign keys stay OFF to mirror D1, which does not enable them.
 */
export function createMigratedDatabase(): SqliteDatabase {
  const db = createBareDatabase()
  applyMigrationFiles(db, listMigrationFiles())
  return db
}

/** Column names of a table, for asserting that a migration actually landed. */
export function tableColumns(db: SqliteDatabase, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String((row as { name: unknown }).name))
}
