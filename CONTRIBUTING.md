# Contributing to TMarks

Thanks for your interest in contributing. TMarks is a pnpm + Turborepo
monorepo: a Cloudflare Worker backend (`packages/backend-core`,
`apps/worker`), a React web app (`apps/web`), a Manifest V3 browser extension
(`apps/tab`), and a standalone landing page (`landing`).

## Setup

```bash
pnpm install        # Node ≥ 22.5, pnpm 10
# There is no root `dev` script — run a single app instead:
pnpm --filter @tmarks/web dev      # web app (Vite)
pnpm --filter @tmarks/tab dev      # extension (crxjs dev server)
cd apps/worker && pnpm exec wrangler dev --config wrangler.dev.toml   # local Worker
```

Local backend development needs `apps/worker/.dev.vars` (copy from
`.dev.vars.example`) and a local D1 database via `wrangler d1` — see
`DEPLOY.md`.

## Workflow

1. Open an issue first for anything beyond a small fix, so the design can be
   discussed.
2. Branch from `main`, keep commits focused, and write tests for behavioral
   changes.
3. Every code file must stay ≤ 300 lines (`pnpm check:code-size` enforces
   this; split files rather than exempting). The gate does not cover
   `sql/` — schema files are numbered-domain DDL by design and append-only
   history, not code to be split.
4. Before pushing, make sure everything is green:

```bash
pnpm type-check
pnpm test
pnpm check:code-size
pnpm build
```

(There is no lint gate: no eslint config is wired up, and the per-package
`lint` scripts are placeholders that skip — do not rely on them.)

## Code style

- TypeScript strict; no `any` creep. Shared API shapes live in
  `packages/contracts` (the single contract source).
- D1 schema changes go in `sql/` (the single schema source, numbered domain
  files applied by wrangler in lexical order). Never edit an already-applied
  file — append a new numbered one (see sql/README.md).
- After changing `apps/worker/wrangler.toml` or `.dev.vars`, rerun
  `pnpm exec wrangler types` inside `apps/worker` — the committed
  `worker-configuration.d.ts` is the binding/Env source of truth, and
  `src/worker.ts` fails type-check if the config drops anything the backend
  requires.
- Keep user input parameterized in SQL; dynamic identifiers must come from
  code-side whitelists (see `packages/backend-core/src/lib/bookmarks`).
- Comments document constraints, not the obvious. Follow the surrounding
  file's density and language.

## Conventions

- Backend routes live under `packages/backend-core/src/routes` and are
  mounted in `src/routes/v1.ts` / `src/app.ts`.
- Authentication: JWT middleware for the web app, `X-API-Key` for the
  extension (`middleware/data-auth.ts` picks per request). New data routes
  use `requireDataAuth('<permission>')`.
- Rate limiting prefers the Cloudflare native Rate Limiting binding
  (`RATE_LIMITER`, wrangler.toml) and falls back to D1-backed counting
  (`lib/api-key/rate-limit-binding.ts`); authentication-facing endpoints
  fail closed.

## Workers platform limits (the recurring bug class)

Three audits in a row (R4, R5, R8) caught bugs that pass every test locally
and only fail in production, because local SQLite/miniflare/POSIX does not
model the platform. Before writing a query, script or config that works on
your machine, check it against this list:

- **D1: max 100 bound parameters per query** — every `IN (?)` expansion over a
  user-sized array must go through `chunkForD1In` (`lib/d1-chunk.ts`). The
  sqlite test harness (`test/helpers/sqlite-d1.ts`) enforces this limit live,
  so a violation fails the tests — keep new INs covered by a max-size test.
- **D1: foreign keys are enforced by default** — equivalent to
  `PRAGMA foreign_keys = on`, so the declared `ON DELETE CASCADE/SET NULL`
  clauses do fire. The local adapters (`apps/server`) and the test harness
  are aligned (R8 IN-1 — the old OFF hid violations until a real deploy).
  Delete paths still cascade manually as defense in depth: don't rely on
  the schema clause doing it for you (see `sql/README.md`).
- **Workers PBKDF2: hard 100k iteration cap** — the runtime throws
  NotSupportedError above it; password hashing must always derive its work
  factor via `getPbkdf2Iterations(env)` (default 100000).
- **Free plan: 50 D1 queries per invocation** — a sync push costs ~7-9
  queries per op, so `wrangler.toml` presets `SYNC_MAX_BATCH_SIZE=5` and the
  server rejects wider batches with 400 QUOTA_EXCEEDED (the client halves
  its chunk automatically). Paid plans can raise it to ~120.
- **R2 must be enabled in the Dashboard** — no API/CLI flag turns it on
  (code 10042); the deploy paths degrade to no-snapshot mode automatically
  until it is (one-click script + CI both detect and handle it, R8-M1/M2).
- **Deploys propagate with a seconds-level window** — verify behavior changes
  (e.g. registration closed) a few seconds after `wrangler deploy`, not in the
  same breath.
- **Git checkouts are platform-specific** — Windows defaults to
  `core.autocrlf=true`; shell scripts without an `.gitattributes` `eol=lf` pin
  die on their shebang line (`*.sh text eol=lf` — R8 CD-1). New script or
  config file types need the same pin before users' first clone.
- **CPU architectures exist beyond amd64** — the prebuilt image publishes
  `linux/amd64,linux/arm64` (R8 CD-2). Anything that assumes `uname -m` or
  ships a native binary must handle arm64 (RPi, most NAS, Apple Silicon).

### Local stubs must be STRICTER than the platform, never looser

R8 IN-1 flipped the FK pragma from OFF to ON and immediately surfaced nine
seed bugs in tests — none in production code, but every one of them would
have failed identically on real D1. The general rule the audit distilled:
when a local adapter/harness models a platform constraint, model the
platform's **strict** side. A looser local stub is a green light for a
production-only failure (the sqlite-999-params-vs-D1-100 class of bug);
a stricter stub can only produce a false alarm, which costs minutes.

## Reporting security issues

See `SECURITY.md` — do not open public issues for vulnerabilities.