import { afterEach, describe, expect, it } from 'vitest'
import { hashRefreshToken } from '@tmarks/backend-core'
import { rotateRefreshSession } from '../src/lib/auth'
import {
  AUTH_PASSWORD as PASSWORD,
  closeAuthHarness,
  loginOk,
  mountLogin,
  mountLogout,
  mountRefresh,
  mountRegister,
  refreshCookieFrom,
  seedPasswordUser,
  setupAuth,
} from './helpers/auth-route-harness'

/**
 * Auth 路由 handler 级回归网(此前零覆盖):登录成功/统一 401、注册校验与
 * 重复冲突、refresh 轮换、已轮换令牌复用 → 全会话吊销(TOKEN_REUSE_DETECTED)、
 * 轮换竞态的守卫(rotateRefreshSession 二次调用必须失败)、登出吊销、
 * 登录 IP 桶 429。真实 SQLite + 迁移 schema,走生产 SQL。
 */

afterEach(closeAuthHarness)

describe('login handler', () => {
  it('returns an access token, user payload and an HttpOnly refresh cookie', async () => {
    const { env, sqlite } = setupAuth()
    await seedPasswordUser(sqlite)
    const res = await loginOk(mountLogin(env))

    const data = await res.json() as { data: { access_token: string; user: { id: string } } }
    expect(data.data.access_token.split('.')).toHaveLength(3)
    expect(data.data.user.id).toBe('auth-user')
    const setCookie = res.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('tmarks_rt=')

    const sessions = sqlite.prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ?').get('auth-user') as { n: number }
    expect(sessions.n).toBe(1)
  })

  it('answers the same uniform 401 for wrong password and unknown user', async () => {
    const { env, sqlite } = setupAuth()
    await seedPasswordUser(sqlite)
    const call = mountLogin(env)

    const wrong = await call({ username: 'auth-user', password: 'wrong-password' })
    const unknown = await call({ username: 'ghost', password: 'whatever-pass' })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    const wrongBody = await wrong.json() as { error: { message: string } }
    const unknownBody = await unknown.json() as { error: { message: string } }
    expect(wrongBody.error.message).toBe(unknownBody.error.message)
  })

  it('rejects missing fields and oversized passwords without hashing them', async () => {
    const { env } = setupAuth()
    const call = mountLogin(env)
    expect((await call({ username: 'auth-user' })).status).toBe(400)
    expect((await call({ username: 'auth-user', password: 'x'.repeat(129) })).status).toBe(401)
  })

  it('429s the IP bucket after 30 attempts within the minute window', async () => {
    const { env } = setupAuth()
    const call = mountLogin(env)
    let status = 0
    for (let i = 0; i < 31; i++) {
      // 空 body 在限流判定之后、PBKDF2 之前被 400 拒绝:只消耗 IP 桶。
      const res = await call({})
      status = res.status
    }
    expect(status).toBe(429)
  })
})

describe('refresh handler', () => {
  it('rotates the refresh token and issues a fresh access token', async () => {
    const { env, sqlite } = setupAuth()
    await seedPasswordUser(sqlite)
    const loginRes = await loginOk(mountLogin(env))
    const firstToken = refreshCookieFrom(loginRes)

    const res = await mountRefresh(env)(firstToken)
    expect(res.status).toBe(200)
    const data = await res.json() as { data: { access_token: string } }
    expect(data.data.access_token).toBeTruthy()

    const secondToken = refreshCookieFrom(res)
    expect(secondToken).not.toBe(firstToken)
    const rows = sqlite
      .prepare('SELECT revoked_at FROM auth_tokens WHERE user_id = ? ORDER BY created_at')
      .all('auth-user') as Array<{ revoked_at: string | null }>
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]!.revoked_at).not.toBeNull()
    expect(rows[rows.length - 1]!.revoked_at).toBeNull()
  })

  it('revokes the whole session when a rotated token is replayed', async () => {
    const { env, sqlite } = setupAuth()
    await seedPasswordUser(sqlite)
    const loginRes = await loginOk(mountLogin(env))
    const firstToken = refreshCookieFrom(loginRes)

    const refresh = mountRefresh(env)
    const rotatedRes = await refresh(firstToken)
    expect(rotatedRes.status).toBe(200)
    const secondToken = refreshCookieFrom(rotatedRes)

    // 旧令牌重放 → TOKEN_REUSE_DETECTED,整条会话(含刚轮换出的新令牌)吊销。
    const replay = await refresh(firstToken)
    expect(replay.status).toBe(401)
    const replayBody = await replay.json() as { error: { code?: string } }
    expect(replayBody.error.code).toBe('TOKEN_REUSE_DETECTED')

    const afterReplay = await refresh(secondToken)
    expect(afterReplay.status).toBe(401)
    const live = sqlite
      .prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .get('auth-user') as { n: number }
    expect(live.n).toBe(0)
  })

  it('rejects unknown and expired refresh tokens with 401', async () => {
    const { env } = setupAuth()
    const refresh = mountRefresh(env)
    expect((await refresh('nonexistent-token-value')).status).toBe(401)

    const bodyMissing = await refresh('')
    expect(bodyMissing.status).toBe(400)
  })

  it('guards the rotation race: a second rotate on the same token row fails', async () => {
    const { env, sqlite } = setupAuth()
    await seedPasswordUser(sqlite)
    const loginRes = await loginOk(mountLogin(env))
    const token = refreshCookieFrom(loginRes)
    const tokenHash = await hashRefreshToken(token)
    const row = sqlite
      .prepare('SELECT id, user_id, session_id, remember_me FROM auth_tokens WHERE refresh_token_hash = ?')
      .get(tokenHash) as { id: number; user_id: string; session_id: string; remember_me: number }

    const first = await rotateRefreshSession({
      db: env.DB, tokenId: row.id, userId: row.user_id,
      refreshTokenHash: await hashRefreshToken('next-token-a'),
      sessionId: row.session_id ?? 's1', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdAt: new Date().toISOString(), rememberMe: false,
    })
    const second = await rotateRefreshSession({
      db: env.DB, tokenId: row.id, userId: row.user_id,
      refreshTokenHash: await hashRefreshToken('next-token-b'),
      sessionId: row.session_id ?? 's1', expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      createdAt: new Date().toISOString(), rememberMe: false,
    })
    expect(first).toBe(true)
    expect(second).toBe(false)
  })
})

describe('register handler', () => {
  it('creates a user and rejects duplicates with 400 CONFLICT', async () => {
    const { env, sqlite } = setupAuth()
    const call = mountRegister(env)

    const created = await call({ username: 'newbie', password: PASSWORD })
    expect(created.status).toBe(200)
    const user = sqlite.prepare('SELECT id FROM users WHERE username = ?').get('newbie') as { id: string } | undefined
    expect(user).toBeTruthy()

    const dup = await call({ username: 'newbie', password: PASSWORD })
    expect(dup.status).toBe(400)
    const dupBody = await dup.json() as { error: { code?: string } }
    expect(dupBody.error.code).toBe('CONFLICT')
  })

  it('validates username, password and email shapes', async () => {
    const { env } = setupAuth()
    const call = mountRegister(env)
    expect((await call({ username: 'bad name!', password: PASSWORD })).status).toBe(400)
    expect((await call({ username: 'ok-name', password: 'short' })).status).toBe(400)
    expect((await call({ username: 'ok-name', password: PASSWORD, email: 'not-an-email' })).status).toBe(400)
  })

  it('is disabled unless ALLOW_REGISTRATION is exactly "true"', async () => {
    const { env } = setupAuth()
    env.ALLOW_REGISTRATION = 'false'
    const res = await mountRegister(env)({ username: 'someone', password: PASSWORD })
    expect(res.status).toBe(403)
  })
})

describe('logout handler', () => {
  it('revokes the presented refresh token and clears the cookie', async () => {
    const { env, sqlite } = setupAuth()
    await seedPasswordUser(sqlite)
    const loginRes = await loginOk(mountLogin(env))
    const token = refreshCookieFrom(loginRes)

    const res = await mountLogout(env, { user_id: 'auth-user' })({ refresh_token: token })
    expect(res.status).toBe(204)
    expect(res.headers.get('Set-Cookie')).toContain('tmarks_rt=;')
    const live = sqlite
      .prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .get('auth-user') as { n: number }
    expect(live.n).toBe(0)
  })

  it('revoke_all kills every session of the user', async () => {
    const { env, sqlite } = setupAuth()
    await seedPasswordUser(sqlite)
    const login = mountLogin(env)
    await loginOk(login)
    await loginOk(login)

    const res = await mountLogout(env, { user_id: 'auth-user' })({ revoke_all: true })
    expect(res.status).toBe(204)
    const live = sqlite
      .prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .get('auth-user') as { n: number }
    expect(live.n).toBe(0)
  })

  it('falls back to revoking the access token session when no refresh cookie is presented', async () => {
    const { env, sqlite } = setupAuth()
    await seedPasswordUser(sqlite)
    const loginRes = await loginOk(mountLogin(env))
    const token = refreshCookieFrom(loginRes)
    const row = sqlite
      .prepare('SELECT session_id FROM auth_tokens WHERE user_id = ?')
      .get('auth-user') as { session_id: string }

    const res = await mountLogout(env, { user_id: 'auth-user', session_id: row.session_id })({})
    expect(res.status).toBe(204)
    const live = sqlite
      .prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .get('auth-user') as { n: number }
    expect(live.n).toBe(0)
    // 之后的 refresh(旧令牌)也不应再成功。
    expect((await mountRefresh(env)(token)).status).toBe(401)
  })
})
