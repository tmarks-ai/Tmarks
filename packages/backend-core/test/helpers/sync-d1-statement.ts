import type { SyncMemoryD1Database } from './sync-d1-memory'

export class SyncMemoryD1Statement {
  private values: unknown[] = []

  constructor(
    private readonly db: SyncMemoryD1Database,
    /** SQL string exposed so db.batch() can route SELECT vs write statements. */
    readonly sql: string,
    values?: unknown[],
  ) {
    if (values) this.values = values
  }

  // R8 BT-9: bind() returns a NEW statement, mirroring real D1 (and the
  // sqlite-d1 harness) — the old in-place mutation aliased two bound
  // statements from one prepare() onto the same object, silently executing
  // the second bind's values for both.
  bind(...values: unknown[]) {
    return new SyncMemoryD1Statement(this.db, this.sql, values)
  }

  async first<T>() {
    return this.db.first(this.sql, this.values) as T | null
  }

  async all<T>() {
    return this.db.all<T>(this.sql, this.values)
  }

  async run() {
    return this.db.run(this.sql, this.values)
  }
}
