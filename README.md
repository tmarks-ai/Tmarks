# TMarks

**AI Bookmarking, Tab-Group Collection & Cross-Device Sync.**

One-click bookmarking, whole-window tab collection, page snapshots, folders
& tags, AI-powered organization, and multi-device sync. Self-hosted and
open source.

**中文说明：** AI 书签与标签页收纳系统——一键书签、整窗标签页收纳、网页快照、
文件夹与标签、AI 智能整理、多端同步。开源自托管。

## Deploy

### Option A: Docker (one command)

```bash
git clone https://github.com/tmarks-ai/Tmarks.git
cd Tmarks
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
docker compose up -d
```

Open `http://localhost:8787`, then enable registration temporarily:

```bash
echo "JWT_SECRET=$(openssl rand -base64 32)
ALLOW_REGISTRATION=true" > .env
docker compose up -d
# Register your account, then remove ALLOW_REGISTRATION and restart
```

- **Data persists** in the `tmarks-data` Docker volume (SQLite + snapshot files)
- **Migrations run automatically** on first startup and on upgrades
- **Rate limiting** uses SQLite-backed counters (no external dependencies)
- Works on any VPS, home server, or NAS with Docker

### Option B: Cloudflare Workers (free tier)

See [DEPLOY.md](./DEPLOY.md) for the full Cloudflare Workers + D1 + R2
deployment guide (free tier fully supported).

## Install the Browser Extension

1. `pnpm --filter @tmarks/tab build` — output at `apps/tab/dist`
2. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `apps/tab/dist`
3. In the extension settings, set the **API source** to your server URL
4. Create an API key from the web app (Settings → API) and paste it in

## Features

| Feature | Description |
|---|---|
| **One-click bookmarking** | Save any page with a single click |
| **Tab collection** | Snap an entire browser window into a tagged group |
| **Page snapshots** | Full-page HTML snapshots with 20-version rotation |
| **AI organization** | BYOK (bring your own key) — classify bookmarks via OpenAI-compatible APIs |
| **Cross-device sync** | Extension ↔ web sync with revision-based conflict resolution |
| **Folder & tag system** | Two-level folders with drag-and-drop reordering |
| **Public sharing** | Share your public bookmarks via a URL slug |

## Project Structure

```
apps/
  web/         React 19 + Vite 7 + Tailwind v4 (SPA)
  tab/         MV3 extension (Dexie + revision sync)
  worker/      Cloudflare Worker entry (consumes backend-core)
  server/      Node.js/Docker server entry (SQLite + filesystem)
packages/
  contracts/   Shared TypeScript contracts (DTOs, permissions, error codes)
  ai/          AI classification client (provider-agnostic, BYOK)
  backend-core/ Hono backend (routes, middleware, sync engine)
landing/       Landing page (standalone build)
skills/         Bookmark organizing guide (user-facing)
sql/            D1/SQLite schema (01-08, append-only)
```

## Quick Start (Development)

```bash
pnpm install        # Node ≥ 22.5, pnpm 10
pnpm build          # turbo run build
pnpm type-check     # turbo run type-check
pnpm test           # turbo run test (499+ tests)
pnpm check:code-size
```

## Security

- **Web:** JWT access token + HttpOnly refresh cookie (rotation + reuse detection)
- **Extension:** Fine-grained `X-API-Key` with per-route permissions
- **Fail-closed startup:** missing migrations or weak `JWT_SECRET` (<32 chars) = no service
- **Self-reporting responsibly:** see [SECURITY.md](./SECURITY.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) (includes the Workers platform
limits checklist). Code of conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) © 2024–2026 TMarks Team. Third-party notices: [NOTICE.md](./NOTICE.md).
