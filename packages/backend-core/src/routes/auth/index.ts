import { Hono } from 'hono'
import type { AppEnv } from '../../lib/env'
import { requireAuth } from '../../middleware/auth'
import { loginHandler } from './login'
import { logoutHandler } from './logout'
import { refreshHandler } from './refresh'
import { registerHandler } from './register'

export const authRoutes = new Hono<AppEnv>()

authRoutes.post('/register', registerHandler)
authRoutes.post('/login', loginHandler)
authRoutes.post('/refresh', refreshHandler)
authRoutes.all('/logout', requireAuth, logoutHandler)
