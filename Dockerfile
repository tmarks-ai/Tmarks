# --- Build stage: install deps + build web app ---
FROM node:22-slim AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/tab/package.json apps/tab/
COPY apps/worker/package.json apps/worker/
COPY apps/server/package.json apps/server/
COPY packages/contracts/package.json packages/contracts/
COPY packages/backend-core/package.json packages/backend-core/
COPY packages/ai/package.json packages/ai/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @tmarks/web build

# --- Runtime stage: slim image with only what's needed ---
FROM node:22-slim

WORKDIR /app

# Copy the pnpm workspace structure + node_modules (hoisted)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=builder /app/packages/backend-core/node_modules ./packages/backend-core/node_modules
COPY --from=builder /app/packages/ai/node_modules ./packages/ai/node_modules

# Application source (TypeScript — executed with tsx, which resolves the
# monorepo's extensionless bundler-style imports that Node strip-types cannot)
COPY packages/contracts/ ./packages/contracts/
COPY packages/backend-core/ ./packages/backend-core/
COPY packages/ai/ ./packages/ai/
COPY apps/server/ ./apps/server/

# Built web app (static files)
COPY --from=builder /app/apps/web/dist/ ./apps/web/dist/

# D1 migrations
COPY sql/ ./sql/

# Persistent data (SQLite + R2 files) — mount a volume here
VOLUME /app/data

ENV NODE_ENV=production
ENV TMARKS_DATA_DIR=/app/data
ENV TMARKS_WEB_DIST=/app/apps/web/dist

# R8 (main-line P3): run as the non-root `node` user shipped with the base
# image instead of root — a compromise of the entry process must not own the
# app source. The data dir must be chowned first: a named volume inherits the
# image path's ownership on first mount, and a root-owned /app/data would
# make the SQLite open fail under USER node.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/v1/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["apps/server/node_modules/.bin/tsx", "apps/server/src/main.ts"]
