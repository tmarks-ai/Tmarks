# 浏览器扩展(TMarks Tab)安装与协作指南

扩展(Manifest V3)与 Web 应用、Cloudflare Worker 后端三方协作的完整链路:

```
扩展 popup/options ──X-API-Key──▶ Worker /api/v1(书签/标签组/快照/同步)
扩展 background   ──sync 协议──▶ Worker /api/v1/sync/push|changes|bootstrap|summary|status
Web 应用          ──JWT(Cookie)─▶ Worker /api/v1(控制面: 登录/设置/API key/分享)
Web 应用          ◀──web-bridge──▶ 扩展 background(OPEN_TABS / GET_SYNC_STATUS)
```

## 1. 构建

```bash
pnpm --filter @tmarks/tab build      # 产物 apps/tab/dist
pnpm --filter @tmarks/tab package:zip # dist → release/tmarks-extension-<版本>.zip(商店上传包,排除 .map)
```

扩展要求 Chrome/Edge ≥ 102(`minimum_chrome_version`)。

## 2. 安装(开发者模式)

1. Chrome/Edge 打开 `chrome://extensions`,开启「开发者模式」。
2. 「加载已解压的扩展程序」→ 选择 `apps/tab/dist`。
3. 固定扩展图标,打开 popup。

## 3. 配置 API 源与密钥(前后端协作的关键两步)

1. **API 源**:popup 底部/options「设置」中填入 Worker 地址,如 `https://tmarks.<子域>.workers.dev`
   (本地开发默认 `http://localhost:8787`)。该值只允许 http(s),存于扩展本地存储。
2. **API 密钥**:在 Web 应用「设置 → API」点「创建标签页 API 密钥」,复制弹出的完整密钥
   (**仅显示一次**,列表只显示前缀)。粘贴到扩展设置页保存。扩展以 `X-API-Key` 头访问数据面。

> 密钥明文存在于:创建响应一次、扩展 `chrome.storage.local`(本地明文持久化——这是
> "登录态跨浏览器重启"的代价;设备盘加密由操作系统负责)。服务端只存 SHA-256 哈希
> 与 `tmk_live_…` 前缀。AI 服务商密钥(BYOK)同样本地明文持久(见第 5 节)。

## 4. 权限模型

扩展密钥按 Web 设置页模板(FULL)创建,包含 bookmarks/bookmark_folders/tags/tab_groups
全部 CRUD + user.read + user.preferences 读写。控制面(设置/API key/分享页)只接受 Web
登录 JWT,数据面 API Key 不包含 `api_keys.manage`。
同步端点要求 `sync` 读写所需的超集权限;只读密钥会被 403,失效密钥 401。

## 5. AI 服务商预设

- 扩展内置 7 家服务商兜底;打开选项页时从已配置的 API 源拉取
  `${origin}/ai-presets.json`(随 web 部署更新,改清单无需发扩展版本)。
- 清单条目强制校验(schema_version=1、baseUrl 仅 https);拉取失败回退 7 天内
  缓存,再回退内置。已保存连接自带 protocol/baseUrl 快照,不受清单增删影响。
- 密钥(BYOK)与 AI 连接(供应商/模型/激活项)存 `chrome.storage.local`,跨浏览器
  重启持久(与后端 API Key 同姿态,本机明文);连接列表可随时查看/复制密钥。
  不经服务端、manifest 无内容脚本,storage 只有扩展自身受信上下文可读。
  AI 整理偏好(语言/提示词风格/温度)同库持久;请勿在共享或他人设备上使用。

## 6. 同步协作

- 本地数据存 Dexie(`apps/tab/src/lib/db`),所有变更入 `syncQueue` 后防抖 1.5s 推送。
- 推送按 `device_id + client_operation_id` 幂等;服务端 14 天幂等键 TTL + 概率清理。
- 拉取按游标分页(`/sync/changes`),冲突(revision 不匹配)返回 server_payload 供 UI 复核
  (`options → 同步健康 → 复核队列`)。
- 快照由按需注入的采集函数(`chrome.scripting.executeScript`)消毒后经 `X-API-Key`
  上传 R2(每书签最多 20 版,单快照 ≤6MB)。

## 7. Web ↔ 扩展桥

Web 书签页的「在浏览器中打开」走 web-bridge:扩展不使用静态 content_scripts(不再随
每个 http(s) 页面注入),而是 background 在标签页加载完成时按需把桥函数注入 API 源
(Web 应用域)所在的标签页;SW 冷启动时对已打开的 API 源标签页补注入。background
侧仍校验 sender 来源与消息类型白名单(仅 OPEN_TABS/GET_SYNC_STATUS),OPEN_TABS
限 50 条且仅 http(s)。页面信息/快照提取同样按需 `executeScript` 注入。详见 SECURITY.md。

## 8. 排障

| 症状 | 检查 |
|---|---|
| 401 | 密钥是否粘贴完整;密钥是否被吊销(设置 → API) |
| 403 | 密钥权限不足(需 FULL 模板);同步需完整 CRUD 集 |
| 同步不生效 | API 源是否为 http(s);options → 同步健康查看队列与游标 |
| popup 空白 | 是否加载了 `dist` 而非 `src`;`pnpm --filter @tmarks/tab build` 重新构建后重载扩展 |