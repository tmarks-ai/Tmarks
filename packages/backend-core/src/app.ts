import { Hono } from 'hono'
import type { AppEnv } from './lib/env'
import { cors } from './middleware/cors'
import { securityHeaders } from './middleware/security-headers'
import { cachePolicy } from './middleware/cache-policy'
import { requestLogger } from './middleware/request-logger'
import { jsonBodyGuard } from './middleware/json-body-guard'
import { handleAppError, handleNotFound } from './middleware/error-handler'
import { v1Routes } from './routes/v1'
import { publicShareRoutes } from './routes/public-share'
import { publicAssetRoutes } from './routes/assets'

const app = new Hono<AppEnv>()

// Global, non-auth middleware chain (order matches the old _middleware.ts).
app.use('*', requestLogger)
app.use('*', cors)
app.use('*', cachePolicy)
app.use('*', securityHeaders)
app.use('*', jsonBodyGuard)

app.onError(handleAppError)
app.notFound(handleNotFound)

// One canonical product API. Cloudflare only hosts this Worker.
app.route('/api/v1', v1Routes)
app.route('/api/public', publicShareRoutes)
// Content-addressed bookmark images (also used by the share page); sits under
// /api/public/* so the cache-policy middleware exempts it from no-store.
app.route('/api/public/assets', publicAssetRoutes)

export { app }
