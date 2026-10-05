import { app, checkMigrationsApplied, drainStorageCleanupJobs, getEnvironmentIssue } from '@tmarks/backend-core'
import type { Env as RequiredEnv } from '@tmarks/backend-core'

// Env 不再手写:由 `wrangler types` 从 wrangler.toml 生成(worker-configuration.d.ts,
// 全局环境接口),改 wrangler.toml / .dev.vars 后须重跑生成——官方规则"never
// hand-write Env, bindings drift 到部署期才炸"。下面的编译期校验把生成 Env
// 钉到 backend-core 的结构需求上:配置删/改绑定或密钥时,这里在编译期红,
// 而不是线上 500。
const _configSatisfiesLibrary: RequiredEnv = null as unknown as Env
void _configSatisfiesLibrary

// Both gates are checked on first request and cached once they pass, so a dev
// worker recovers after `wrangler d1 migrations apply` without a restart. They
// fail closed (503): a missing schema or a weak JWT secret must never serve
// traffic, since either would let attackers forge sessions or read stale data.
let migrationsVerified = false
let environmentVerified = false

function serviceUnavailable(message: string): Response {
  return new Response(
    JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message } }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  )
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Only /api/* reaches here: `run_worker_first = ["/api/*"]` in wrangler.toml
    // routes everything else to Static Assets with SPA fallback.
    if (!environmentVerified) {
      const issue = getEnvironmentIssue(env)
      environmentVerified = issue === null
      if (issue) {
        return serviceUnavailable(issue)
      }
    }
    if (!migrationsVerified) {
      const result = await checkMigrationsApplied(env.DB)
      migrationsVerified = result.ok
      if (!result.ok) {
        return serviceUnavailable('Database migrations have not been applied.')
      }
    }
    return app.fetch(request, env, ctx)
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Scheduled maintenance uses the same D1/R2 bindings and is deliberately
    // independent of request authentication. The migration probe prevents a
    // pre-migration deployment from repeatedly logging query errors.
    const migration = await checkMigrationsApplied(env.DB)
    if (!migration.ok) {
      console.error('Skipping storage cleanup drain:', migration.error)
      return
    }
    ctx.waitUntil(
      // R8 BL-5: free plan caps D1 at 50 queries/invocation and each job costs
      // 2-3 queries, so an explicit limit keeps the hourly drain inside the
      // budget (~1 + 15×3 + margin < 50); the default 100 aborted mid-drain.
      drainStorageCleanupJobs(env, { now: new Date(controller.scheduledTime), limit: 15 })
        .then((result) => {
          if (result.processed > 0) {
            console.log('Storage cleanup drain:', result)
          }
        })
        .catch((error) => console.error('Storage cleanup drain failed:', error)),
    )
  },
}
