# TMarks 部署文档

> 基于 Cloudflare Workers + D1 + R2 的自托管部署方案（免费档可完整运行）

---

## 0. 五分钟总览

首次部署的最短路径，各步详情见对应章节：

```bash
# ① 创建资源（1.1）
wrangler d1 create tmarks-db          # 记下 database_id 填入 wrangler.toml
wrangler r2 bucket create tmarks-snapshots

# ② 应用数据库迁移（3.1；--remote 必须，否则 wrangler 操作本地开发库）
cd apps/worker && pnpm exec wrangler d1 migrations apply tmarks-db --remote

# ③ 设置 JWT 密钥（3.2）
pnpm exec wrangler secret put JWT_SECRET   # openssl rand -base64 32 生成

# ④ 部署（3.3）
pnpm --filter @tmarks/web build && pnpm exec wrangler deploy

# ⑤ 创建首个账户（3.4，必读——注册默认关闭）
pnpm exec wrangler deploy --var ALLOW_REGISTRATION:true   # 注册后常规 deploy 恢复关闭

# ⑥ 安装浏览器扩展并连接（4）
```

> 以上命令需先完成第 2 节的令牌配置（`set -a && source ~/.config/tmarks/deploy.env && set +a`）。

---

## 1. 前置条件

### 1.1 账号与资源

| 项目 | 说明 |
|---|---|
| Cloudflare 账号 | 注册 [cloudflare.com](https://cloudflare.com) |
| D1 数据库 | `wrangler d1 create tmarks-db`，把打印出的 database_id 填入 `apps/worker/wrangler.toml` 的 `database_id = "<your-d1-database-id>"` |
| R2 存储桶 | `wrangler r2 bucket create tmarks-snapshots`（网页快照存储；漏掉此步 `wrangler deploy` 因桶不存在而失败） |
| Node.js | ≥ 22.5（根 `package.json` 已声明 engines） |
| pnpm | ≥ 10（`packageManager: pnpm@10.28.1`） |

### 1.2 创建 API Token

1. Dashboard → **My Profile** → **API Tokens** → **Create Token**
2. 选择 **Edit Cloudflare Workers** 模板（或自定义），需包含：

| 权限 | 级别 | 用途 |
|---|---|---|
| Account / Workers Scripts | Edit | 部署 Worker |
| Account / D1 | Edit | D1 读写、迁移 |
| Account / Workers R2 Storage | Edit | R2 桶绑定 |
| Account / Account Settings | Read | 账号信息 |

3. 创建后 **立即复制 Token**（仅显示一次）
4. Account ID 见 Dashboard 首页右侧栏

---

## 2. 令牌配置

在项目**目录之外**创建部署凭据文件（例如用户主目录下的 `~/.config/tmarks/deploy.env`），不要放在仓库根目录：

```bash
# ~/.config/tmarks/deploy.env
CLOUDFLARE_API_TOKEN=你的API_Token
CLOUDFLARE_ACCOUNT_ID=你的Account_ID
```

之后每条 wrangler 命令前加载：

```bash
set -a && source ~/.config/tmarks/deploy.env && set +a    # bash
```

> ⚠️ 凭据文件绝不能放进项目目录、压缩包、备份或 CI 工作区。旧的根目录
> `.cf-deploy.env` 即使已被 `.gitignore` 忽略，也必须在轮换 Token 后移出并删除。
> Token 定期轮换（Dashboard → API Tokens → Roll）。PowerShell / 环境差异写法见第 8 节。

---

## 3. 首次部署

按顺序执行——**迁移先于部署**，否则迁移门禁会对全部 `/api/*` 返回 503。

### 3.1 应用数据库迁移

```bash
cd apps/worker
set -a && source ~/.config/tmarks/deploy.env && set +a

# --remote 必须：不带时 wrangler 操作的是本地 Miniflare 库，生产库不会有任何变化
pnpm exec wrangler d1 migrations list tmarks-db --remote    # 查看待应用项
pnpm exec wrangler d1 migrations apply tmarks-db --remote   # 应用
```

Schema 说明：`sql/` 是唯一执行来源（01–08 按域编号：账户认证/目录/书签/标签
/标签组/同步/分享搜索/R2 清理 outbox，由 wrangler 按文件名顺序应用；前身 migrations/0001–0006
迁移链已等价合并删除，见 sql/README.md）。全新库一次 apply 即得完整 schema；
曾应用过旧迁移链的库按 sql/README.md「旧库对账」一节做一次性账本对账后再
apply。新增迁移的规则见 5.2。

### 3.2 设置 JWT 密钥

```bash
# 生成（至少 32 字符；弱密钥/占位值会被 Worker 启动校验直接拒绝）
openssl rand -base64 32

cd apps/worker
pnpm exec wrangler secret put JWT_SECRET    # 粘贴生成的值
```

### 3.3 部署

```bash
# 构建前端（Vite 产物 → apps/web/dist）
pnpm --filter @tmarks/web build

cd apps/worker
pnpm exec wrangler deploy
```

部署成功输出：

```
✨ Success! Uploaded 24 files (7 already uploaded)
Deployed tmarks triggers
  https://tmarks.<子域>.workers.dev
```

架构：`/api/*` 由 Worker（Hono 后端）处理，其余走 Static Assets + SPA
Fallback（前端页面）。静态资源与 Worker 同次部署上传。**Web 前端必须与 Worker 同源部署**；当前生产构建 CSP 使用 `connect-src 'self'`，刷新 Cookie 使用 `SameSite=Lax`，不要把普通 Web 客户端部署到另一 origin 后只依赖 CORS。扩展请求使用独立的扩展权限，不受这条同源限制。

> 静态根目录里有 `ai-presets.json`（AI 服务商预设清单，公开可读）：扩展打开
> 选项页时从已配置的 API 源拉取 `${origin}/ai-presets.json`，同 id 覆盖内置
> 预设、新 id 追加——**更新服务商列表/默认模型只需改这份文件并部署 web，
> 不需要发扩展版本**。扩展端强制校验（schema_version=1、baseUrl 仅 https），
> 拉取失败回退 7 天内缓存，再回退扩展内置清单。

> 首次部署请在输出中确认 binding 列表包含 `RATE_LIMITER (Rate Limit)`、
> `ASSET_RATE_LIMITER (Rate Limit)` 与 `GLOBAL_RATE_LIMITER (Rate Limit)`——第一个让
> 登录/分享/注册的限流判定零 D1 读写；第二个（600 次/分钟/键）单独治理公开资产
> 读取（书签网格冷缓存单页可达 100-200 张图，不能复用 60/min 的共享限流器）；
> 第三个（600 次/分钟/键）承载 `login:global` / `share:global` 等全站喷雾桶——
> 若复用 60/min 的共享限流器，单个攻击 IP 节流打满即可让全站登录/分享页持续
> 429。三个限流器用官方 `[[ratelimits]]` schema（Wrangler ≥4.36，`namespace_id`
> 为必填的账号内唯一正整数字符串）；旧的 `[[unsafe.bindings]] type="ratelimit"`
> 写法会被 versions API 以错误 10021 拒绝。若某账号区域不支持此类 binding，
> 部署会报错或回退：删除 `wrangler.toml` 中对应 `[[ratelimits]]` 段即可，功能
> 无损（自动回退 D1 限流，详见 9.1）。

### 3.4 创建首个账户（必读）

注册端点默认关闭（`ALLOW_REGISTRATION !== 'true'` 时返回 403），且没有
CLI 引导——不执行此步，全新部署永远无法创建账户：

```bash
cd apps/worker
set -a && source ~/.config/tmarks/deploy.env && set +a
pnpm exec wrangler deploy --var ALLOW_REGISTRATION:true
# ↑ 打开 https://tmarks.<子域>.workers.dev 完成注册
pnpm exec wrangler deploy    # 注册完成后常规部署，恢复关闭
```

> 本产品为单用户设计：注册自己的账户后务必恢复关闭，避免公网开放注册。

### 3.5 部署后验证（1 分钟冒烟）

- [ ] 打开 workers.dev 域名，登录成功
- [ ] 设置 → API → 创建「标签页 API 密钥」，复制（仅显示一次）
- [ ] 新建一条书签正常显示
- 迁移门禁若返回 503（`Database migrations have not been applied`）→ 重跑 3.1

---

## 4. 安装浏览器扩展并连接

扩展为 Chromium 内核（Chrome/Edge/Brave）通用，开发者模式加载：

```bash
pnpm --filter @tmarks/tab build    # 产物 apps/tab/dist
```

1. 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `apps/tab/dist`
2. 扩展设置（popup 底部或 options）→ **API 源**填 `https://tmarks.<子域>.workers.dev`
3. **API 密钥**粘贴 3.5 创建的密钥
4. 打开任意网页点扩展图标验证保存与同步

完整协作链路（同步协议、权限模型、排障）见 [EXTENSION.md](./EXTENSION.md)。

---

## 5. 日常部署与升级

### 5.1 日常部署

```bash
pnpm --filter @tmarks/web build
cd apps/worker && set -a && source ~/.config/tmarks/deploy.env && set +a
pnpm exec wrangler deploy
```

> 版本升级若带了新迁移文件（`sql/` 出现新序号），先
> `wrangler d1 migrations apply tmarks-db --remote` 再 deploy——顺序同首次部署。

### 5.2 创建新迁移

在 `sql/` 下追加 `序号_主题.sql`（序号接续、域写进文件名——08 已被
`08_storage_cleanup.sql` 占用，下一个是 `09_…`）；已应用的文件名与内容不可改（wrangler 账本
按文件名记账），规则详见 sql/README.md。随后
`wrangler d1 migrations apply tmarks-db --remote`。本地开发用 `--local`（见第 7 节）。

---

## 6. 自定义域名（可选）

- **方式 A（需 Token 加 Zone/DNS/Edit 权限）**：`apps/worker/wrangler.toml`
  的 `routes` 声明 `{ pattern = "你的域名", custom_domain = true }` 后重新部署
- **方式 B（无 DNS 权限）**：Dashboard → Workers → `tmarks` → Settings →
  Triggers → Custom Domains → Add，Cloudflare 自动建 DNS 记录

---

## 7. 本地开发

### 7.1 环境变量

```bash
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# 编辑 .dev.vars：JWT_SECRET 必须替换（占位值会被启动校验拒绝）
```

### 7.2 启动（两个一次性前置 + 两个终端）

```bash
# 一次性①：构建前端产物（wrangler 的 assets 指向 ../web/dist，该目录被
# gitignore，全新克隆直接 wrangler dev 会报错）
pnpm --filter @tmarks/web build

# 一次性②：本地迁移（否则迁移门禁对全部 /api/* 返回 503）
cd apps/worker && pnpm exec wrangler d1 migrations apply tmarks-db --local && cd ../..

# 终端 1：前端 HMR
pnpm --filter @tmarks/web dev

# 终端 2：Worker（连接本地 D1）
cd apps/worker && pnpm dev
```

> 未登录 wrangler（没有 Cloudflare API token）时的替代：`cd apps/worker && pnpm exec wrangler dev --config wrangler.dev.toml`。该变体只是去掉了远程 ratelimit binding（限流自动走 D1 兜底），**仅限本地 dev，禁止用它 deploy**。

---

## 8. 环境差异（部署命令前缀）

**PowerShell**：

```powershell
$deployEnv = Join-Path $HOME '.config\\tmarks\\deploy.env'
$vars = Get-Content $deployEnv | ForEach-Object {
  if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)$') {
    [PSCustomObject]@{ Key = $matches[1]; Value = $matches[2].Trim('"') }
  }
}
$env:CLOUDFLARE_API_TOKEN = ($vars | Where-Object Key -eq 'CLOUDFLARE_API_TOKEN').Value
$env:CLOUDFLARE_ACCOUNT_ID = ($vars | Where-Object Key -eq 'CLOUDFLARE_ACCOUNT_ID').Value
```

**Linux / macOS**：`export $(grep -v '^#' ~/.config/tmarks/deploy.env | xargs)`

---

## 9. 运维参考

### 9.1 D1 免费额度账本

免费档：**每天 500 万行读 / 10 万行写 / 5GB 存储**。计费关键语义：
行读按**扫描**行数计（非返回行数）——无索引过滤、`LIKE '%x%'`、`COUNT(*)`
都按扫描量计，`LIMIT` 不省。

内置优化（2k 书签规模实测）：

| 项 | 优化前 | 优化后 |
|---|---|---|
| 恶意探测（登录/分享 4 万次/天） | ~22 万行写/天，单凭此项打穿写额度，超限当日 D1 拒服 | **0 行写**（原生 Rate Limiting binding）；无 binding 回退 D1 分钟单窗（1/3~1/9 写入） |
| 公开分享页每次访问 | ~2 万行读 | 默认 `no-store`（隐私变更即刻生效，读放大为设计取舍——限流 600/min/键封顶洪泛） |
| 书签列表页（100 条） | ~100 次额外往返（目录路径逐行查） | 1 次 IN 查询 |
| 批量/重排的 `id IN` 校验 | 每次全表扫 | 索引点查（迁移 0002） |
| 创建/导入重复检查 | 每条全表扫 | 每条 2 次点查 |
| 每个扩展请求 | ~5 行写 | ~1 行写（binding 限流 + last_used 节流） |
| 每个网页请求 | 3 行写 | 1 行写 |

容量参考（单用户日常）：约 **60~80 万行读/天、4~6 千行写/天**，
免费额度留 5~10 倍余量。

`RATE_LIMITER` binding：`wrangler.toml` 已配置（60 次/分钟/键，免费），
单一速率统一约束登录/分享/注册/API-key 桶。调速率改 `simple.limit`；
删除 binding 自动回退 D1 限流（每判定 1 行写）。公开资产读取
（`/api/public/assets`）走独立的 `ASSET_RATE_LIMITER`（600 次/分钟/键）：
书签卡片图冷缓存单页可达 100-200 张，不能与 60/min 的共享限流器同池；
无该 binding 时回退 D1 双桶（per-IP + 全局，minute 窗口）。

### 9.2 存储增长

- 快照：每书签 20 版轮换（超出删最旧，表行与 R2 对象经 durable outbox 进清理
  流程，小时级 cron 排空）、同内容去重、单快照 ≤6MB
- `audit_logs` / `bookmark_click_events`：90 天概率清理（waitUntil 保障完成）
- `sync_changes`：按实体压实保新（非按龄 TTL）；幂等键 14 天、设备表 90 天
- R2 免费档 10GB 只是单用户参考值，不是容量保证；大量快照可能产生费用或耗尽额度，需查看 R2 用量并按需清理

> 免费版还有 **50 查询/Worker 调用**上限：每个同步 op 实耗 ~7-9 个 D1 查询
> （幂等占位 + 实体读回 + 归属/查重 + 写入 + sync_change），默认 100-op 推送
> 在第一批就超预算——500 落入扩展端"网络错误"分支烧光重试预算、打成死信
> （R8 BL-1/TA-1）。已由 `wrangler.toml` 预置 `SYNC_MAX_BATCH_SIZE=5` 兜底：
> 服务端对超宽批次返回 400 QUOTA_EXCEEDED，扩展端自动减半 chunk 收敛，
> 免费档无需任何配置；Workers Paid（1000 查询/调用）可调到 ~120。

### 9.3 落地页（可选，独立部署）

`landing/` 独立于本 monorepo 工作区：

```bash
cd landing && pnpm install && pnpm build
# 生产构建建议带站点域名，让 og:url / og:image 成为绝对地址
# （社交抓取器不解析相对路径的 og:image，缺失会导致分享无卡片图）：
SITE_URL=https://your-landing-domain pnpm build
# Cloudflare Pages：Git 集成（构建命令必须含 install——landing 不在 pnpm 工作区
# globs 里,根目录 pnpm install 不会装它的依赖,Pages 的环境也不会）：
#   cd landing && pnpm install && pnpm build     输出目录 landing/dist
# 或 wrangler pages deploy landing/dist
```

字体已自托管（`landing/public/fonts/`，latin 子集），无第三方字体请求，
大陆访问不受 Google Fonts 不可达影响；不要把 Google Fonts 的 `<link>` 加回
`index.html`——`public/_headers` 的 CSP 已不再放行 googleapis/gstatic。

部署前把 `landing/src/config.ts` 的 `githubUrl` 占位替换为真实仓库地址
（未填时 GitHub 按钮与 footer 资源栏自动隐藏）。

---

### 9.4 R2 未启用的过渡部署

R2 需要在 Dashboard 手动激活（一次性，可能要求支付信息），CLI 无法代办。
未启用时可以先去掉 `wrangler.toml` 的 `[[r2_buckets]]` 段部署——后端对缺失
`SNAPSHOTS` 绑定有完整的优雅降级：favicon/封面持久化自动跳过
（`asset-persist.ts`），快照上传/读取/删除返回 `SNAPSHOT_STORAGE_UNAVAILABLE`
清晰错误码而非崩溃，其余功能全部正常。激活 R2 后 `wrangler r2 bucket create
tmarks-snapshots`、把 `[[r2_buckets]]` 段加回配置再 deploy 即可，无需改代码。

## 10. 发布前 Checklist

- [ ] 分支变更已合入 `main`
- [ ] 新迁移已在生产库应用（`migrations list` 为空）
- [ ] `wrangler deploy` 输出确认 5 个 binding：`DB` / `SNAPSHOTS` / `RATE_LIMITER` / `ASSET_RATE_LIMITER` / `GLOBAL_RATE_LIMITER`（R2 未启用的过渡期可暂无 `SNAPSHOTS`，见 9.4）
- [ ] `wrangler deploy` 输出确认 cron 触发器（`tmarks triggers` 行应列出 `["0 * * * *"]`）：storage_cleanup 排空依赖它，缺失则 R2 清理重试永不执行
- [ ] 首账户已创建，`ALLOW_REGISTRATION` 已恢复关闭（注册接口返回 403 为预期；重部署后等几秒再验证——部署传播有秒级窗口）
- [ ] 冒烟：登录 → 建书签 → 扩展保存带快照 → 扩展 options 同步健康页无红项
- [ ] `landing/src/config.ts` 的 `githubUrl` 已填或确认保持隐藏
- [ ] 落地页以 `SITE_URL=<域名> pnpm build` 构建，分享卡片（og:image PNG）已用抓取调试工具验证

---

## 11. 排障

| 问题 | 解决方案 |
|---|---|
| `fetch failed` / 网络超时 | 重试 `wrangler deploy`（Cloudflare API 偶发超时） |
| `Authentication error` | 检查 `~/.config/tmarks/deploy.env` 的 Token 是否有效/过期 |
| `database not found` | `wrangler.toml` 的 `database_id` 是否正确 |
| 全部 `/api/*` 返回 503「migrations not applied」 | 执行 3.1（迁移先于部署） |
| 全部请求 503 且报 JWT_SECRET | 执行 3.2（缺失/过短/占位值均会被拒绝，要求 ≥32 字符） |
| 注册返回 403 REGISTRATION_DISABLED | 预期行为；首账户见 3.4 |
| 扩展 401 | API 密钥粘贴是否完整、是否被吊销（设置 → API） |
| 扩展 403 | 密钥需 FULL 模板权限（同步需完整 CRUD 集） |
| 同步不生效 | 扩展 API 源是否为 http(s)；options → 同步健康查看队列与游标 |
| 注册/登录全 500，日志见 `Pbkdf2 failed: iteration counts above 100000 are not supported` | Workers 运行时对 PBKDF2 有 100k 迭代硬上限，代码默认已为此取 100000；确认没有把 `PBKDF2_ITERATIONS` 设成更高值（仅本地 Node 运行时可用高值） |

---

## 12. 文件速查

| 文件 | 说明 |
|---|---|
| `~/.config/tmarks/deploy.env` | 部署令牌（项目目录之外，不提交） |
| `apps/worker/wrangler.toml` | Worker 配置（D1/R2/RateLimiter/Assets/Vars） |
| `apps/worker/.dev.vars(.example)` | 本地开发密钥（模板 / 实际，后者不提交） |
| `apps/web/dist/` | 前端构建产物（部署时自动上传） |
| `apps/tab/dist/` | 扩展构建产物（开发者模式加载） |
| `sql/` | D1 schema 唯一来源（01–08 域文件，追加式演进，见 sql/README.md） |
| `EXTENSION.md` | 扩展构建/安装/协作链路/排障 |
