---
name: deploy-tmarks
description: 一键部署 TMarks（AI 书签与标签页收纳系统）到 Cloudflare Workers 或 Docker。当用户说"部署 TMarks / 帮我搭建 TMarks / 部署这个书签项目"时使用。支持两种方式：Docker（最简）或 Cloudflare Workers（免费全球边缘）。
---

# TMarks 部署 Skill

> **skill 版本:** `deploy-tmarks.v1`  
> **适用代理:** Claude Code / Codex / Cursor / workbuddy / 任何能执行终端命令的 AI 代理

## 你的任务

根据用户的选择（Docker 或 Cloudflare），帮他们完成 TMarks 的全部部署。用户只需要提供密钥，你负责执行所有命令。

---

## 方式一：Docker 部署（最简，适合本地/VPS）

### 前置检查

```bash
docker --version  # 确认 Docker 已安装
```

如果没装 Docker，告诉用户去 https://docs.docker.com/get-docker/ 安装。

### 部署步骤

```bash
# 1. Clone 项目
git clone https://github.com/tmarks-ai/Tmarks.git
cd Tmarks

# 2. 生成 JWT 密钥（≥32 字符）
openssl rand -base64 32

# 3. 把生成的值告诉用户，写入 .env
echo "JWT_SECRET=<刚才生成的值>" > .env

# 4. 启动
docker compose up -d

# 5. 验证
curl http://localhost:8787/api/v1/health
# 期望: {"status":"ok","environment":"production"}
```

### 首次注册

```bash
# 临时开启注册
echo "JWT_SECRET=<同上>
ALLOW_REGISTRATION=true" > .env
docker compose up -d

# 提示用户打开 http://localhost:8787 注册账户

# 注册完成后关闭
echo "JWT_SECRET=<同上>" > .env
docker compose up -d
```

---

## 方式二：Cloudflare Workers 部署（免费全球边缘）

### 你需要向用户索要的 3 个值

| 值 | 怎么获取 |
|---|---|
| **Cloudflare API Token** | https://dash.cloudflare.com/profile/api-tokens/create → Create Custom Token → 4 个权限（见下表） |
| **Cloudflare Account ID** | https://dash.cloudflare.com 首页右侧栏 |
| **GitHub Personal Access Token** | https://github.com/settings/tokens/new?scopes=repo,workflow （fork 部署用） |

Cloudflare Token 需要的 4 个权限：

| 权限 | 级别 |
|---|---|
| Account → Workers Scripts | Edit |
| Account → D1 | Edit |
| Account → Workers R2 Storage | Edit |
| Account → Account Settings | Read |

### 部署步骤（全自动，你执行所有命令）

```bash
# ─── 1. 设置环境变量（用户提供的值）───
export CLOUDFLARE_API_TOKEN="<用户的CF令牌>"
export CLOUDFLARE_ACCOUNT_ID="<用户的Account ID>"
export GITHUB_TOKEN="<用户的GitHub令牌>"
export JWT_SECRET="$(openssl rand -base64 32)"

# ─── 2. Clone 并进入项目 ───
git clone https://github.com/tmarks-ai/Tmarks.git
cd Tmarks

# ─── 3. 直接部署到 Cloudflare（跳过 CI，一次到位）───
cd apps/worker

# 创建 D1 数据库（如果已存在会报错，忽略）
npx wrangler d1 create tmarks-db 2>/dev/null || true

# 获取 database_id
DATABASE_ID=$(npx wrangler d1 list --json 2>/dev/null \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const db=d.find(x=>x.name==='tmarks-db'); console.log(db?db.uuid:'')")
echo "database_id: $DATABASE_ID"

# 填入 wrangler.toml
sed -i "s|<your-d1-database-id>|$DATABASE_ID|" wrangler.toml

# 创建 R2 桶（已存在会报错，忽略；10042 = R2 未激活，见下方处理）
if ! npx wrangler r2 bucket create tmarks-snapshots 2>/dev/null; then
  if ! npx wrangler r2 bucket list 2>/dev/null | grep -q tmarks-snapshots; then
    echo "R2 未在 Dashboard 激活 (code 10042) —— 注释 R2 绑定段以降级部署（快照功能暂不可用，其余功能全部正常）"
    # R2 未激活时带绑定 deploy 必失败：注释三行后部署，激活 R2 后去掉注释重部署即可恢复快照
    sed -i.bak '/^\[\[r2_buckets\]\]/,/^bucket_name/ s/^/# /' wrangler.toml && rm -f wrangler.toml.bak
  fi
fi

# 设置 JWT Secret
echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET

# 回到项目根目录，构建前端
cd ../..
pnpm install --frozen-lockfile
pnpm --filter @tmarks/web build

# 应用迁移
cd apps/worker
npx wrangler d1 migrations apply tmarks-db --remote

# 部署
npx wrangler deploy

# ─── 4. 临时开启注册 ───
npx wrangler deploy --var ALLOW_REGISTRATION:true
echo "⚠️ 注册已开启，请用户立即去 workers.dev URL 注册账户"
echo "部署地址看上方 wrangler deploy 输出中的 URL"

# ─── 5. 用户注册完成后关闭注册 ───
npx wrangler deploy

# ─── 6.（可选）配置 GitHub Actions 持续部署 ───
# 仅当用户提供了 GitHub PAT 时执行。CI 在用户自己的 fork 上跑——secrets 必须
# 设到 fork:此前克隆的是上游 tmarks-ai/Tmarks,gh secret set 从 cwd 的 remote
# 解析仓库,对上游公共仓库无权限必然 403/404,本步骤结构性不可达(R8 CD-3)。
if [ -n "$GITHUB_TOKEN" ]; then
  if ! command -v gh >/dev/null; then
    echo "未安装 GitHub CLI(gh)——跳过 CI/CD 配置"
    echo "告诉用户:后续更新需要手动重新部署(重跑方式二),或安装 gh 后重跑本步骤"
  else
    export GH_TOKEN="$GITHUB_TOKEN"
    # Fork 到用户账户(已存在会静默跳过),再把本地克隆的 remote 指向 fork
    gh repo fork tmarks-ai/Tmarks --clone=false 2>/dev/null || true
    FORK_REPO="$(gh api user --jq .login)/Tmarks"
    git remote set-url origin "https://github.com/$FORK_REPO.git"
    # -R 显式定向到 fork,不依赖 cwd 的 remote 解析
    gh secret set CLOUDFLARE_API_TOKEN --repo "$FORK_REPO" <<< "$CLOUDFLARE_API_TOKEN"
    gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$FORK_REPO" <<< "$CLOUDFLARE_ACCOUNT_ID"
    gh secret set JWT_SECRET --repo "$FORK_REPO" <<< "$JWT_SECRET"
    echo "✅ CI/CD 已配置到 $FORK_REPO:后续 git push 到 fork 的 main 自动部署"
  fi
fi
```

---

## 部署后验证

```bash
# Cloudflare
curl https://<workers域名>.workers.dev/api/v1/health
# 期望: {"status":"ok","environment":"production"}

# Docker
curl http://localhost:8787/api/v1/health
```

## 安装浏览器扩展

```bash
pnpm --filter @tmarks/tab build
```

告诉用户：
1. 打开 `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择 `apps/tab/dist`
2. 扩展设置 → API 源填部署地址
3. 从 Web 设置页创建 API 密钥并粘贴到扩展

## 排障

| 问题 | 解决 |
|---|---|
| `R2 bucket create 失败 (code 10042)` | 需要先在 https://dash.cloudflare.com → R2 → Get Started 手动激活（一次性）；或按上方脚本注释 `[[r2_buckets]]` 三行降级部署 |
| `deploy 报 R2 bucket tmarks-snapshots 不存在/绑定失败` | 同上——R2 未激活时不能带 R2 绑定部署：注释 `wrangler.toml` 的 `[[r2_buckets]]` 段后重新 `wrangler deploy` |
| `d1 create 失败 (already exists)` | 正常，跳过即可 |
| `deploy 后 503 migrations not applied` | 运行 `npx wrangler d1 migrations apply tmarks-db --remote` |
| `deploy 后 503 JWT_SECRET` | 运行 `echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET` |
| 扩展 401 | API 密钥被吊销或格式错误——从 Web 设置页重新创建 |

## 变更记录

- v1 (2026-10-01): 初始版本，支持 Docker 直装 + Cloudflare 全自动 + GitHub CI/CD 可选配置
