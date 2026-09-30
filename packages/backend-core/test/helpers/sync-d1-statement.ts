import type { SyncMemoryD1Database } from './sync-d1-memory'

export class SyncMemoryD1Statement {
  private values: unknown[] = []

  constructor(
    private readonly db: SyncMemoryD1Database,
    /** SQL string exposed so db.batch() can route SELECT vs write statements. */
    readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values
    return this
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
