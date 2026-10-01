#!/usr/bin/env bash
# TMarks 一键部署脚本
# 用法: bash scripts/one-click-deploy.sh
# 前置: 已安装 Node.js ≥22、git;浏览器会弹出 Cloudflare 授权页
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

echo ""
echo "═══════════════════════════════════════════"
echo "       TMarks 一键部署"
echo "═══════════════════════════════════════════"
echo ""

# ─── 检查前置 ───
command -v node >/dev/null || fail "Node.js 未安装 (https://nodejs.org)"
command -v git  >/dev/null || fail "Git 未安装 (https://git-scm.com)"
NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
[ "$NODE_MAJOR" -lt 22 ] && fail "Node.js 版本 ≥22 需要 (当前 $(node --version))"

# ─── 第 1 步: 登录 Cloudflare（浏览器弹出授权页，点 Allow）───
echo "─── 第 1 步: 登录 Cloudflare ───"
echo "即将打开浏览器，请在页面上点击 [Allow] 授权。"
echo ""
npx wrangler login
info "Cloudflare 已授权"

# ─── 第 2 步: 获取 Account ID ───
echo ""
echo "─── 第 2 步: 获取 Account ID ───"
ACCOUNT_ID=$(npx wrangler whoami 2>&1 | grep -oP 'Account ID: \K[a-f0-9]{32}' | head -1)
[ -z "$ACCOUNT_ID" ] && ACCOUNT_ID=$(npx wrangler whoami 2>&1 | grep -oP '[a-f0-9]{32}' | head -1)
[ -z "$ACCOUNT_ID" ] && fail "无法获取 Account ID"
info "Account ID: $ACCOUNT_ID"

# ─── 第 3 步: Clone 项目 ───
echo ""
echo "─── 第 3 步: 获取项目 ───"
if [ -d "Tmarks" ]; then
  cd Tmarks
  git pull --rebase 2>/dev/null || true
  info "已更新到最新版本"
else
  git clone https://github.com/tmarks-ai/Tmarks.git
  cd Tmarks
  info "项目已克隆"
fi

# ─── 第 4 步: 创建 D1 数据库（自动获取 database_id）───
echo ""
echo "─── 第 4 步: 创建 D1 数据库 ───"
cd apps/worker

# 创建（如果已存在会失败，忽略）
npx wrangler d1 create tmarks-db 2>/dev/null && info "D1 数据库已创建" || info "D1 数据库已存在"

# 获取 database_id
DATABASE_ID=$(npx wrangler d1 list --json 2>/dev/null \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const db=d.find(x=>x.name==='tmarks-db'); console.log(db?db.uuid:'')")
[ -z "$DATABASE_ID" ] && fail "无法获取 database_id"
info "database_id: $DATABASE_ID"

# 填入 wrangler.toml（幂等：只在占位符存在时替换）
if grep -q "<your-d1-database-id>" wrangler.toml; then
  if command -v sed >/dev/null; then
    sed -i.bak "s|<your-d1-database-id>|$DATABASE_ID|" wrangler.toml
  else
    # macOS 兼容
    sed -i '' "s|<your-d1-database-id>|$DATABASE_ID|" wrangler.toml
  fi
  rm -f wrangler.toml.bak
  info "database_id 已填入 wrangler.toml"
fi

# ─── 第 5 步: 创建 R2 桶（幂等）───
echo ""
echo "─── 第 5 步: 创建 R2 存储桶 ───"
if npx wrangler r2 bucket create tmarks-snapshots 2>/dev/null; then
  info "R2 存储桶已创建"
else
  warn "R2 可能已存在或需要先在 Dashboard 激活 (https://dash.cloudflare.com → R2)"
  warn "如果 R2 未激活，部署仍可运行（快照功能会优雅降级）"
fi

# ─── 第 6 步: 生成并设置 JWT 密钥 ───
echo ""
echo "─── 第 6 步: 设置 JWT 密钥 ───"
JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET
info "JWT 密钥已设置（自动生成，≥32 字符）"

# ─── 第 7 步: 构建前端 ───
echo ""
echo "─── 第 7 步: 构建前端 ───"
cd ../..
if command -v pnpm >/dev/null; then
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  pnpm --filter @tmarks/web build
else
  npm install -g pnpm@10
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install
  pnpm --filter @tmarks/web build
fi
info "前端构建完成"

# ─── 第 8 步: 应用数据库迁移 ───
echo ""
echo "─── 第 8 步: 应用数据库迁移 ───"
cd apps/worker
npx wrangler d1 migrations apply tmarks-db --remote
info "数据库迁移完成"

# ─── 第 9 步: 部署（临时开启注册）───
echo ""
echo "─── 第 9 步: 部署 ───"
npx wrangler deploy --var ALLOW_REGISTRATION:true

DEPLOY_URL=$(npx wrangler whoami 2>&1 | grep -oP 'https://\S+\.workers\.dev' | head -1)
[ -z "$DEPLOY_URL" ] && DEPLOY_URL="查看上方 deploy 输出中的 URL"

echo ""
echo "═══════════════════════════════════════════"
echo -e "${GREEN}  ✅ 部署成功！${NC}"
echo "═══════════════════════════════════════════"
echo ""
echo "  部署地址: $DEPLOY_URL"
echo ""
echo -e "${YELLOW}  ⚠️ 注册当前已开启${NC}"
echo "  1. 打开 $DEPLOY_URL"
echo "  2. 注册你的账户"
echo "  3. 注册完成后，回到终端按 Enter 关闭注册"
echo ""
read -r -p "  注册完成后按 Enter 关闭注册..."
npx wrangler deploy
info "注册已关闭，部署完成"
echo ""
echo "  浏览器扩展安装:"
echo "  1. cd $(pwd) && pnpm --filter @tmarks/tab build"
echo "  2. chrome://extensions → 开发者模式 → 加载 apps/tab/dist"
echo "  3. 扩展设置 → API 源填 $DEPLOY_URL"
echo "  4. 从 Web 设置页创建 API 密钥粘贴到扩展"
echo ""
echo "═══════════════════════════════════════════"
