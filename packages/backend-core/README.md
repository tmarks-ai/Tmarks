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
  auth/          password login, refresh sessions, JWT bootstrap
  api-key/       key generation, permissions, rate limits, usage logs
  bookmarks/     bookmark and folder domain logic
  sync/          Web/Tab incremental synchronization
  tab-groups/    tab groups and items
  tags/          tag domain logic
  preferences/   personal settings
  cache/         private response cache helpers
  crypto/        encryption and token helpers
  routes/        canonical `/api/v1` Hono routes
```

The Worker entry point imports `app`, `checkMigrationsApplied`, and `Env` from
this package. D1 migrations remain the source of truth for schema evolution.

All source files are kept at or below 300 lines; run `pnpm type-check` and
`pnpm check:code-size` before handing off changes.
