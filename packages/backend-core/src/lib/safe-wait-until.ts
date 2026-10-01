import type { Context } from 'hono'
import type { AppEnv } from './env'

/**
 * A waitUntil adapter that tolerates a missing ExecutionContext.
 *
 * The Workers runtime always provides c.executionCtx, but two driving modes do
 * not: `app.request()` in the integration-test harness and the self-hosted
 * Node.js server (apps/server) via `app.fetch()`. Accessing c.executionCtx
 * there throws "This context has no ExecutionContext", which used to turn
 * background writes (the 1% audit-retention sweep, api-key last_used/usage
 * logging, snapshot object cleanup) into a 500 for the end user —
 * intermittently in tests (the 1% sweep) and on every extension request in
 * the Docker deployment. Background work degrades to fire-and-forget instead:
 * the long-lived Node process settles the promise, and a logged rejection
 * never escalates to an unhandled one.
 */
export function getSafeWaitUntil(c: Context<AppEnv>): (promise: Promise<unknown>) => void {
  return (promise) => {
    try {
      c.executionCtx.waitUntil(promise)
    } catch {
      void promise.catch((error) => {
        console.error('[waitUntil-fallback] background task failed:', error)
      })
    }
  }
}
