# sql/ — TMarks schema 唯一来源（按业务域分类）

本目录是 D1 数据库 schema 的**唯一执行来源**：`wrangler d1 migrations apply`
按文件名顺序（01→08）应用，八个域文件按依赖序覆盖全部表、索引、触发器与
FTS5 表。测试夹具（`packages/backend-core/test/helpers/sqlite-migrations.ts`）
与 schema-baseline、tag-count 等测试直接消费本目录。

## 沿革

本目录前身为 `migrations/0001–0006` 迁移链。2026-09-23 合并：等价性测试
证明分类集与迁移链最终态逐字节同构后，删除旧链、本目录转为唯一来源（与
0001 基线当初合并 129 个旧迁移同一先例）。合并前已应用旧链的数据库须按
「旧库对账」一节处理。

## 后续结构变更约定（追加，不改既有文件）

- **已应用的文件名与内容一律不可改**：wrangler 的 d1_migrations 账本按文件名
  记账，改内容让旧库拿不到变更，改名让旧库重放撞表。
- **外键（FK）在 D1 上默认强制执行**——等同 `PRAGMA foreign_keys = on`，
  schema 声明的 `ON DELETE CASCADE/SET NULL` 动作随之生效；本地适配器
  （apps/server）与测试夹具均已对齐（R8 IN-1，此前 OFF 造成"本地绿/线上
  炸"）。删除路径仍应手动删子行作为纵深防御：不依赖 cascade，让行为在
  任何执行环境下显式一致（见 CONTRIBUTING「Workers platform limits」节）。
- 新结构变更追加 `09_<主题>.sql`、`10_…`（序号接续、域写进文件名；08 已被
  `08_storage_cleanup.sql` 占用），与既有域文件的编号体系自然衔接。
- 域内新增的小型 DDL（如索引）可直接追加到既有域文件**仅当该文件尚未被任何
  环境应用过**——已应用过的文件必须走新增文件。
- 每个新迁移建议配升级路径回归测试（夹具提供 `createBareDatabase` +
  `applyMigrationFiles`，按文件名前缀分段应用）。

## 文件清单

| 文件 | 域 | 内容 |
|---|---|---|
| 01_users_and_auth.sql | 账户与凭据 | users、auth_tokens、api_keys（+日志/限流）、audit_logs、user_preferences |
| 02_folders.sql | 目录 | bookmark_folders 及其索引 |
| 03_bookmarks.sql | 书签 | bookmarks、bookmark_click_events、bookmark_snapshots 及其索引 |
| 04_tags.sql | 标签 | tags、bookmark_tags 关联表、维护式计数的全部五个触发器 |
| 05_tab_groups.sql | 标签组 | tab_groups、tab_group_items 及其索引 |
| 06_sync.sql | 同步 | sync_changes、sync_devices、sync_entity_revisions、sync_idempotency_keys |
| 07_share_and_search.sql | 分享与搜索 | public_share_pages、FTS5 三张搜索表（占位，无填充/查询路径） |
| 08_storage_cleanup.sql | R2 清理 outbox | storage_cleanup_jobs 及其到期索引（R5 审计引入） |

文件内的「原 000X 迁移引入」注释为历史溯源标注（旧迁移编号），仅说明出处。

## 旧库对账（曾应用 migrations/0001–0006 旧链的数据库）

wrangler 账本记的是旧文件名，本目录对它而言全是"未应用的新迁移"，直接
`migrations apply` 会撞 table already exists。二选一：

1. **重建（推荐，本项目无生产数据）**：`wrangler d1 create` 新库（或删除本地
   dev 状态）后正常 `wrangler d1 migrations apply`。
2. **原地保数据**：先 `wrangler d1 execute` 补齐旧链缺失的结构（apply 过
   0005/0006 旧版的库已含 FTS 与计数结构，仅需回填计数，SQL 见
   AUDIT-2026-09-11.md 附十二），再把本目录八个文件名 INSERT 进 d1_migrations
   账本标记为已应用，之后回到正常追加流程。

运行期 SQL（REST/同步的查询语句）与绑定逻辑耦合，保持在 TypeScript 单一来源
内，不进本目录。
