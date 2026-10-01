import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, drainStorageCleanupJobs } from '@tmarks/backend-core'
import { createPersistentD1 } from './sqlite-d1'
import { FilesystemR2 } from './fs-r2'

/**
 * TMarks self-hosted Node.js server (Docker / VPS deployment).
 *
 * Replaces the Cloudflare Workers runtime with:
 * - D1 → persistent SQLite (node:sqlite, WAL mode, migration ledger)
 * - R2 → local filesystem (data dir, sidecar content-type metadata)
 * - Native rate limiters → D1/SQLite fallback (already built into backend-core)
 * - Workers Static Assets → @hono/node-server serveStatic
 * - Cron triggers → setInterval
 *
 * Configuration (all via environment variables):
 *   TMARKS_PORT          HTTP port (default: 8787)
 *   TMARKS_DATA_DIR      persistent data dir (default: ./data)
 *   TMARKS_WEB_DIST      web app build output (default: ../web/dist)
 *   JWT_SECRET           ≥32 chars, REQUIRED (fail-closed without it)
 *   ALLOW_REGISTRATION   "true" to enable registration (default: disabled)
 *   ENVIRONMENT          "production" or "development" (default: production)
 */

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.TMARKS_PORT || 8787)
const DATA_DIR = resolve(process.env.TMARKS_DATA_DIR || join(__dirname, '../../data'))
const WEB_DIST = resolve(process.env.TMARKS_WEB_DIST || join(__dirname, '../../web/dist'))
const MIGRATIONS_DIR = resolve(join(__dirname, '../../../sql'))

// --- Validate required config (fail-closed, same as the Workers gate) ---
const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET is missing or shorter than 32 characters.')
  console.error('Set it via: JWT_SECRET=$(openssl rand -base64 32)')
  process.exit(1)
}

const ENVIRONMENT = process.env.ENVIRONMENT === 'development' ? 'development' : 'production'

// --- Initialize storage adapters ---
const DB = createPersistentD1(join(DATA_DIR, 'tmarks.db'), MIGRATIONS_DIR)
const SNAPSHOTS = new FilesystemR2(join(DATA_DIR, 'r2'))

console.log(`[server] database: ${join(DATA_DIR, 'tmarks.db')}`)
console.log(`[server] r2 storage: ${join(DATA_DIR, 'r2')}`)
console.log(`[server] static files: ${WEB_DIST}`)
console.log(`[server] environment: ${ENVIRONMENT}`)

// --- Bindings object matching the Workers Env interface ---
const bindings = {
  DB,
  SNAPSHOTS,
  JWT_SECRET,
  ENVIRONMENT,
  // First-registration flow: pass ALLOW_REGISTRATION through so the documented
  // `docker run -e ALLOW_REGISTRATION=true` works; omitted = closed (403).
  ...(process.env.ALLOW_REGISTRATION === 'true' ? { ALLOW_REGISTRATION: 'true' } : {}),
  // Rate limiters intentionally absent: backend-core falls back to
  // D1/SQLite-backed rate limiting automatically.
} as Record<string, unknown>

// --- Assemble the server ---
const server = new Hono()

// /api/* → the full backend-core middleware chain (CORS, security headers,
// json body guard, error handler, all routes). Non-API requests fall
// through to the static file serving below.
server.all('/api/*', (c) => {
  return app.fetch(c.req.raw, bindings)
})

// Security headers for static file responses (the API gets them from the
// backend-core middleware; static files need them set here).
server.use('*', async (c, next) => {
  await next()
  c.header('X-Frame-Options', 'DENY')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.header('Content-Security-Policy', "frame-ancestors 'none'")
})

// Static files (JS/CSS/images/fonts) from the web dist
server.use('*', serveStatic({ root: WEB_DIST }))

// SPA fallback: any unmatched path serves index.html (client-side routing)
server.get('*', serveStatic({ path: join(WEB_DIST, 'index.html') }))

// --- Storage cleanup cron (hourly, mirrors the Workers cron trigger) ---
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000
setInterval(() => {
  void drainStorageCleanupJobs(bindings as never, { now: new Date() })
    .then((result) => {
      if (result.processed > 0) console.log('[cron] storage cleanup:', result)
    })
    .catch((error) => console.error('[cron] storage cleanup failed:', error))
}, CLEANUP_INTERVAL_MS)

// --- Start ---
console.log(`[server] listening on http://0.0.0.0:${PORT}`)
serve({ fetch: server.fetch, port: PORT })
