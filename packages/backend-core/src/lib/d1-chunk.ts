/**
 * D1 hard-caps bound parameters at 100 per query
 * (https://developers.cloudflare.com/d1/platform/limits/). Local SQLite's
 * variable limit is 999/32k and miniflare does not enforce D1's, so an
 * `IN (?)` expansion that 500s in production passes tests green — the R5-1
 * audit proved this live: a 100-id bulk request failed with 500 while 95
 * passed. Every `IN (...)` over user-sized arrays must chunk through here.
 */
export const D1_MAX_BIND_PARAMS = 100

/**
 * Split `ids` into chunks that fit a single `IN (...)` query whose other
 * (fixed) parameters number `fixedParamCount`, so each emitted query binds
 * at most D1_MAX_BIND_PARAMS parameters.
 */
export function chunkForD1In<T>(ids: readonly T[], fixedParamCount: number): T[][] {
  const size = Math.max(1, D1_MAX_BIND_PARAMS - fixedParamCount)
  const chunks: T[][] = []
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size) as T[])
  }
  return chunks
}
