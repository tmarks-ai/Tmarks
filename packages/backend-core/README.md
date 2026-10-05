# @tmarks/backend-core

`backend-core` is the single API runtime for the Cloudflare Worker. Cloudflare
provides the Worker and D1 infrastructure; it is not a user-facing product
module.

The product surface is intentionally small:

- one personal user account
- one canonical `/api/v1` route tree
- independent Web login sessions and Tab `X-API-Key` credentials over the shared data routes
- bookmarks, folders, tags, tab groups, preferences, and single-bookmark AI
- JWT sessions for Web login/control-plane access; API keys are generated there for Tab

## Structure

```text
src/
  lib/
    auth/          password login, refresh sessions, JWT bootstrap
    api-key/       key generation, permissions, rate limits, usage logs
    bookmarks/     bookmark and folder domain logic (incl. asset persistence)
    sync/          Web/Tab incremental synchronization (bootstrap/push/pull)
    tab-groups/    tab group domain logic
    tags/          tag domain logic
    preferences/    personal settings
    import-export/ JSON export collection and streaming
    net/           outbound fetch guards (SSRF defenses)
    share/         public share-page settings
    crypto/        encryption and token helpers
    storage-cleanup.ts  durable R2-deletion outbox + hourly drain
    d1-chunk.ts    D1 100-bound-parameter chunking helper
    safe-wait-until.ts waitUntil adapter tolerating a missing ExecutionContext
  middleware/      CORS, security headers, JSON body guard, auth, error handler
  routes/          canonical `/api/v1` Hono route tree
  app.ts           middleware chain assembly
```

The Worker entry point imports `app`, `checkMigrationsApplied`, and `Env` from
this package. D1 migrations remain the source of truth for schema evolution.

All source files are kept at or below 300 lines; run `pnpm type-check` and
`pnpm check:code-size` before handing off changes.
