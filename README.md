# TMarks

**AI 书签与标签页收纳系统。**

一键书签、整窗标签页收纳、网页快照、文件夹与标签、AI 智能整理、多端同步。
自托管、开源自托管——Cloudflare Workers 免费档或 Docker 一条命令。

## 部署

### 方式 0：预构建 Docker 镜像（真正的只需一条命令）

```bash
docker run -d -p 8787:8787 \
  -v tmarks-data:/app/data \
  -e JWT_SECRET=$(openssl rand -base64 32) \
  ghcr.io/tmarks-ai/tmarks
```

打开 `http://localhost:8787` 即可使用。不需要 clone、不需要 build、不需要 pnpm。

**首次注册：**

```bash
docker run -d -p 8787:8787 \
  -v tmarks-data:/app/data \
  -e JWT_SECRET=$(openssl rand -base64 32) \
  -e ALLOW_REGISTRATION=true \
  ghcr.io/tmarks-ai/tmarks
# 注册后删除 -e ALLOW_REGISTRATION=true 并重启
```

### 方案 A：Docker Compose（需要 clone）

```bash
git clone https://github.com/tmarks-ai/Tmarks.git
cd Tmarks
echo "JWT_SECRET=$(openssl rand -base64 32)" > .env
docker compose up -d
```

- **数据持久化**在 Docker volume（SQLite + 快照文件）
- **迁移自动执行**——首次启动和升级都无需手动跑 SQL
- **限流**自动回退 SQLite 计数器，零外部依赖
- 任何 VPS、家庭服务器或 NAS 上的 Docker 都能跑

首次注册：

```bash
echo "JWT_SECRET=$(openssl rand -base64 32)
ALLOW_REGISTRATION=true" > .env
docker compose up -d
# 注册账户后，删除 ALLOW_REGISTRATION 行并重启
```

### 方案 B：Cloudflare Workers（免费档，全自动部署）

> 全程在浏览器里操作，**不需要打开终端**。D1 数据库、R2 桶、JWT 密钥全部由 GitHub Actions 自动创建。

#### 第一步：创建 Cloudflare API Token

打开 [https://dash.cloudflare.com/profile/api-tokens/create](https://dash.cloudflare.com/profile/api-tokens/create) → **Create Custom Token** → 添加以下 4 个权限：

| 权限 | 级别 |
|---|---|
| Account → **Workers Scripts** | Edit |
| Account → **D1** | Edit |
| Account → **Workers R2 Storage** | Edit |
| Account → **Account Settings** | Read |

点击 **Continue to summary** → **Create Token** → 复制令牌。

#### 第二步：在 GitHub 添加 3 个 Secrets

打开 [Settings → Secrets and variables → Actions](https://github.com/tmarks-ai/Tmarks/settings/secrets/actions) → **New repository secret**：

| Secret 名 | 值 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 第一步复制的令牌 |
| `CLOUDFLARE_ACCOUNT_ID` | [Cloudflare Dashboard](https://dash.cloudflare.com) 首页右侧栏的 Account ID |
| `JWT_SECRET` | 任何 ≥32 字符的随机字符串（可用[在线密码生成器](https://www.random.org/strings/?num=1&len=44&digits=on&upperalpha=on&loweralpha=on&unique=on&format=html&rnd=new)生成） |

#### 第三步：推送代码（或直接改文件）

```bash
git push origin main
```

或者：在 GitHub 网页上编辑任意文件（如 README）→ Commit changes → 自动触发部署。

#### 首次注册

部署完成后，去 **Actions** → **CI** → **Run workflow** → 勾选 ☑️ **"Temporarily open registration"** → **Run workflow**。

打开 workers.dev URL 注册账户，然后再 Run 一次（不勾选）关闭注册。

**此后每次 push 到 main 自动部署，SQL 迁移自动执行，新资源自动创建。**

## 安装浏览器扩展

```bash
pnpm --filter @tmarks/tab build    # 产物 apps/tab/dist
```

1. 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `apps/tab/dist`
2. 扩展设置 → **API 源** 填你的服务器地址
3. **API 密钥**从 Web 端设置页创建并粘贴

完整协作链路见 [EXTENSION.md](./EXTENSION.md)。

## 功能

| 功能 | 说明 |
|---|---|
| **一键书签** | 任意页面一键保存 |
| **整窗收纳** | 把整个浏览器窗口收进一个标签组 |
| **网页快照** | 全页 HTML 快照，20 版轮换 |
| **AI 智能整理** | BYOK（自带 API key）——通过 OpenAI 兼容接口自动分类 |
| **多端同步** | 扩展 ↔ Web 实时同步，基于 revision 的冲突检测 |
| **文件夹与标签** | 两级目录拖拽排序 + 标签过滤 |
| **公开分享** | 通过 URL slug 分享公开书签 |

## 项目结构

```
apps/
  web/         React 19 + Vite 7 + Tailwind v4（Web 应用）
  tab/         MV3 扩展（Dexie + revision 同步）
  worker/      Cloudflare Worker 入口
  server/      Node.js/Docker 服务器入口
packages/
  contracts/   共享 TypeScript 契约（DTO、权限、错误码）
  ai/          AI 分类客户端（多服务商兼容，BYOK）
  backend-core/ Hono 后端（路由、中间件、同步引擎）
landing/       落地页（独立构建）
skills/         书签整理指南（面向用户与 AI 代理）
sql/            D1/SQLite schema（01-08，追加式演进）
```

## 开发

```bash
pnpm install        # Node ≥ 22.5, pnpm 10
pnpm build          # turbo run build
pnpm type-check     # turbo run type-check
pnpm test           # turbo run test（499+ 条测试）
pnpm check:code-size
```

## 安全

- **Web 端：** 密码登录（JWT 访问令牌 + HttpOnly Cookie 刷新令牌，轮换并检测重用）
- **扩展端：** 细粒度 `X-API-Key`（每路由权限校验）
- **启动 fail-closed：** D1 迁移未应用或 `JWT_SECRET` 弱于 32 字符时拒绝服务
- **漏洞报告：** 见 [SECURITY.md](./SECURITY.md)

## 贡献

见 [CONTRIBUTING.md](./CONTRIBUTING.md)（含 Workers 平台限制清单）。行为准则见 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 许可

[MIT](./LICENSE) © 2024–2026 TMarks Team。第三方声明见 [NOTICE.md](./NOTICE.md)。

## 原则

重写"壳"，复用"算法"：脚手架全新，但 sync / snapshot / license / auth / AI 单条分类的
prompt+解析+fallback / D1 schema 从旧版自研代码移植（© TMarks Team，原 CC BY-NC 4.0，
本仓库随仓库整体以 MIT 再授权，见 NOTICE.md）。

---

## English Summary

**TMarks** — AI bookmarking, tab-group collection & cross-device sync.
Self-hosted on Cloudflare Workers (free tier) or Docker.

- **One-click bookmarking** and whole-window tab collection
- **Page snapshots** with 20-version rotation
- **AI organization** via BYOK (bring your own API key)
- **Cross-device sync** with revision-based conflict resolution
- **Self-hosted**: deploy via `docker compose up -d` or GitHub Actions auto-deploy to Cloudflare Workers
- **499+ tests**, zero known vulnerabilities, five audit rounds passed

Quick deploy: see the Chinese guide above (Docker: `docker compose up -d`;
Cloudflare: 5-step setup with GitHub Actions CI/CD).
