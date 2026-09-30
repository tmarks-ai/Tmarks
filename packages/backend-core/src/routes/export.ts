import { Hono } from 'hono'
import type { ExportOptions, ExportScope } from '@tmarks/contracts'
import { requireAuth } from '../middleware'
import type { AppEnv } from '../lib/env'
import {
  collectExportData,
  createExportJsonStream,
  filterExportData,
  parseExportScope,
  getExportFilename,
  estimateExportSize,
  getExportStats,
} from '../lib/import-export'
import { consumeRateLimit } from '../lib/api-key/rate-limiter'
import type { RateLimitConfig } from '../lib/api-key/rate-limiter-types'
import { success, badRequest, internalError, tooManyRequests } from '../lib/response'

interface ExportPreviewRequest {
  format?: string
  scope?: string
  include_deleted?: boolean
}

// Exports assemble the full account in memory; cap how often a single user can
// trigger them so the endpoint cannot be used to hammer the Worker.
const EXPORT_LIMITS: RateLimitConfig = { per_minute: 3, per_hour: 20, per_day: 100 }

function parseCommonOptions(url: URL): {
  scope: ExportScope
  includeDeleted: boolean
  options: ExportOptions
} {
  const requestedFormat = url.searchParams.get('format') ?? 'json'
  if (requestedFormat !== 'json') {
    throw new Error(`Unsupported export format: ${requestedFormat}`)
  }
  const scope = parseExportScope(url.searchParams.get('scope'))
  const includeDeleted = url.searchParams.get('include_deleted') === 'true'
  const options: ExportOptions = {
    include_tags: url.searchParams.get('include_tags') !== 'false',
    include_metadata: url.searchParams.get('include_metadata') !== 'false',
    format_options: {
      pretty_print: url.searchParams.get('pretty_print') !== 'false',
      include_click_stats: url.searchParams.get('include_stats') === 'true',
    },
  }
  return { scope, includeDeleted, options }
}

export const exportRoutes = new Hono<AppEnv>()

exportRoutes.use('/', requireAuth)

exportRoutes.get('/', async (c) => {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const url = new URL(c.req.url)
  let scope: ExportScope
  let includeDeleted: boolean
  let options: ExportOptions
  try {
    ;({ scope, includeDeleted, options } = parseCommonOptions(url))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.startsWith('Unsupported export format:')) return badRequest('Unsupported export format')
    throw error
  }

  const rate = await consumeRateLimit(`export:${auth.user_id}`, c.env.DB, EXPORT_LIMITS, { onError: 'deny' })
  if (!rate.allowed) {
    return tooManyRequests(
      { code: 'RATE_LIMITED', message: 'Too many export requests' },
      { 'Retry-After': String(rate.retryAfter || 60) }
    )
  }

  const exportData = await collectExportData(c.env.DB, auth.user_id, scope, { includeDeleted })
  const filtered = filterExportData(exportData, options)
  const filename = getExportFilename(filtered.exported_at, scope)
  return new Response(createExportJsonStream(filtered, Boolean(options.format_options.pretty_print)), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  })
})

exportRoutes.post('/', async (c) => {
  const auth = c.get('auth')
  if (!auth) return internalError('User not found')
  const body = await c.req.json<ExportPreviewRequest>()
  const requestedFormat = body.format ?? 'json'
  if (requestedFormat !== 'json') return badRequest('Unsupported export format')
  const scope = parseExportScope(body.scope)
  const includeDeleted = Boolean(body.include_deleted)
  const stats = await getExportStats(c.env.DB, auth.user_id, scope, includeDeleted)
  const estimatedSize = estimateExportSize(stats)
  const estimatedFilename = getExportFilename(new Date().toISOString(), scope)
  return success({ stats, estimated_size: estimatedSize, format: 'json', estimated_filename: estimatedFilename })
})