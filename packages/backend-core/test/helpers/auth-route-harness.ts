import { Hono } from 'hono'
import { hashPassword } from '@tmarks/backend-core'
import { loginHandler } from '../../src/routes/auth/login'
import { refreshHandler } from '../../src/routes/auth/refresh'
import { registerHandler } from '../../src/routes/auth/register'
import { logoutHandler } from '../../src/routes/auth/logout'
import { createSqliteD1, type SqliteD1Harness } from './sqlite-d1'
import type { AppEnv } from '../../src/lib/env'

export const AUTH_SECRET = 'x'.repeat(32)
export const AUTH_PASSWORD = 'correct-horse-battery'

let current: SqliteD1Harness | null = null

/** 每例一套真实 SQLite(与 D1 同源),种子用户统一为 'auth-user'。 */
export function setupAuth(): { env: AppEnv['Bindings']; sqlite: SqliteD1Harness['sqlite'] } {
  current = createSqliteD1('auth-user')
  return { env: { DB: current.db, JWT_SECRET: AUTH_SECRET, ALLOW_REGISTRATION: 'true' }, sqlite: current.sqlite }
}

export function closeAuthHarness(): void {
  current?.close()
  current = null
}

export function mountLogin(env: AppEnv['Bindings']) {
  const app = new Hono<AppEnv>()
  app.post('/login', loginHandler)
  return (body: unknown) => app.request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }, env)
}

export function mountRefresh(env: AppEnv['Bindings']) {
  const app = new Hono<AppEnv>()
  app.post('/refresh', refreshHandler)
  return (refreshToken: string) => app.request('/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }, env)
}

export function mountLogout(env: AppEnv['Bindings'], auth: { user_id: string; session_id?: string } | null) {
  const app = new Hono<AppEnv>()
  app.post('/logout', async (c, next) => {
    if (auth) c.set('auth', { user_id: auth.user_id, auth_type: 'jwt', session_id: auth.session_id })
    await next()
  }, logoutHandler)
  return (body: unknown) => app.request('/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }, env)
}

export function mountRegister(env: AppEnv['Bindings']) {
  const app = new Hono<AppEnv>()
  app.post('/register', registerHandler)
  return (body: unknown) => app.request('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, env)
}

export async function seedPasswordUser(sqlite: SqliteD1Harness['sqlite']): Promise<void> {
  // createSqliteD1 的种子用户名是 `user-${userId}`——统一改成登录用的 'auth-user'。
  sqlite
    .prepare('UPDATE users SET password_hash = ?, username = ? WHERE id = ?')
    .run(await hashPassword(AUTH_PASSWORD), 'auth-user', 'auth-user')
}

export function refreshCookieFrom(response: Response): string {
  const setCookie = response.headers.get('Set-Cookie') ?? ''
  const match = /tmarks_rt=([^;]+)/.exec(setCookie)
  if (!match) throw new Error('no refresh cookie in response')
  return match[1]!
}

export async function loginOk(call: ReturnType<typeof mountLogin>): Promise<Response> {
  const res = await call({ username: 'auth-user', password: AUTH_PASSWORD })
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`)
  return res
}