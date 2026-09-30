# Contributing to TMarks

Thanks for your interest in contributing. TMarks is a pnpm + Turborepo
monorepo: a Cloudflare Worker backend (`packages/backend-core`,
`apps/worker`), a React web app (`apps/web`), a Manifest V3 browser extension
(`apps/tab`), and a standalone landing page (`landing`).

## Setup

```bash
pnpm install        # Node ≥ 20, pnpm 10
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

Two audits in a row (R4, R5) caught bugs that pass every test locally and only
fail in production, because local SQLite/miniflare does not model the platform.
Before writing a query or config that works on your machine, check it against
this list:

- **D1: max 100 bound parameters per query** — every `IN (?)` expansion over a
  user-sized array must go through `chunkForD1In` (`lib/d1-chunk.ts`). The
  sqlite test harness (`test/helpers/sqlite-d1.ts`) enforces this limit live,
  so a violation fails the tests — keep new INs covered by a max-size test.
- **D1: foreign keys** — declared `ON DELETE CASCADE/SET NULL` clauses do not
  fire the way you might expect; the delete paths cascade manually. Don't rely
  on the schema clause doing it for you (see `sql/README.md`).
- **Workers PBKDF2: hard 100k iteration cap** — the runtime throws
  NotSupportedError above it; password hashing must always derive its work
  factor via `getPbkdf2Iterations(env)` (default 100000).
- **Free plan: 50 D1 queries per invocation** — a 100-operation sync push
  exceeds it by design; chunking or docs, not denial, is the answer.
- **R2 must be enabled in the Dashboard** — no API/CLI flag turns it on
  (code 10042); the app runs a documented degraded mode until it is.
- **Deploys propagate with a seconds-level window** — verify behavior changes
  (e.g. registration closed) a few seconds after `wrangler deploy`, not in the
  same breath.

## Reporting security issues

See `SECURITY.md` — do not open public issues for vulnerabilities.