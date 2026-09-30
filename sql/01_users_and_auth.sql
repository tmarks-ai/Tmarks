-- 01_users_and_auth.sql — 账户与凭据域
--
-- sql/ 分类 schema 的账户域文件（见 sql/README.md）。本目录由
-- `wrangler d1 migrations apply` 按文件名顺序应用；正文 DDL 与注释原样
-- 承自基线迁移（0001）。

-- ============================================================
-- 账户与凭据
-- ============================================================

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 登录按 LOWER(username)/LOWER(email) 匹配;列级 UNIQUE 的自动索引是
-- 二进制排序,服务不了大小写不敏感查询,需要表达式索引。
CREATE INDEX idx_users_username_lower ON users(LOWER(username));
CREATE INDEX idx_users_email_lower ON users(LOWER(email));

CREATE TABLE auth_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  session_id TEXT,
  remember_me INTEGER NOT NULL DEFAULT 0 CHECK (remember_me IN (0, 1)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_auth_tokens_hash ON auth_tokens(refresh_token_hash);
CREATE INDEX idx_auth_tokens_expires ON auth_tokens(expires_at);
CREATE INDEX idx_auth_tokens_session ON auth_tokens(user_id, session_id);

CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at TEXT,
  last_used_at TEXT,
  last_used_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_api_keys_status ON api_keys(user_id, status);

CREATE TABLE api_key_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  status INTEGER NOT NULL,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_api_logs_key ON api_key_logs(api_key_id, created_at DESC);
CREATE INDEX idx_api_logs_user ON api_key_logs(user_id, created_at DESC);

-- 限流计数桶:主键即 (主体, 窗口, 窗口起点),写入与判定是一条
-- INSERT..ON CONFLICT 原子语句(见 lib/api-key/rate-limiter.ts)。
CREATE TABLE api_key_rate_limits (
  api_key_id TEXT NOT NULL,          -- 桶键:并非只放 api key(login:/refresh: 等前缀复用)
  window TEXT NOT NULL,              -- minute | hour | day
  window_start INTEGER NOT NULL,     -- unix ms,对齐到窗口起点
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (api_key_id, window, window_start)
);
CREATE INDEX idx_api_key_rate_limits_updated_at ON api_key_rate_limits(updated_at);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_logs_event ON audit_logs(event_type, created_at DESC);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'light',
  page_size INTEGER NOT NULL DEFAULT 30,
  view_mode TEXT NOT NULL DEFAULT 'card',
  density TEXT NOT NULL DEFAULT 'normal',
  tag_layout TEXT NOT NULL DEFAULT 'grid',
  sort_by TEXT NOT NULL DEFAULT 'popular',
  search_auto_clear_seconds INTEGER NOT NULL DEFAULT 15,
  tag_selection_auto_clear_seconds INTEGER NOT NULL DEFAULT 30,
  enable_search_auto_clear INTEGER NOT NULL DEFAULT 1 CHECK (enable_search_auto_clear IN (0, 1)),
  enable_tag_selection_auto_clear INTEGER NOT NULL DEFAULT 0 CHECK (enable_tag_selection_auto_clear IN (0, 1)),
  default_bookmark_icon TEXT NOT NULL DEFAULT 'orbital-spinner',
  bookmark_nav_mode TEXT NOT NULL DEFAULT 'folders',
  bookmark_aux_panel TEXT NOT NULL DEFAULT 'right',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
