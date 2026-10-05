import type { ApiErrorCode } from '@tmarks/contracts'
import type { ApiResponse, ApiError } from './types'

export function success<T>(data: T, meta?: ApiResponse['meta']): Response {
  const body: ApiResponse<T> = { data }
  if (meta) {
    body.meta = meta
  }
  return Response.json(body, { status: 200 })
}

export function created<T>(data: T): Response {
  return Response.json({ data } as ApiResponse<T>, { status: 201 })
}

export function noContent(): Response {
  return new Response(null, { status: 204 })
}

// R8 CA-4: the `code` parameters are ApiErrorCode (from contracts) — a loose
// string is exactly how OWNERSHIP_CONFLICT shipped unregistered.
export function badRequest(error: string | ApiError | Partial<ApiError>, code: ApiErrorCode = 'BAD_REQUEST'): Response {
  const errorObj: ApiError = typeof error === 'string'
    ? { code, message: error }
    : { code: error.code || code, message: error.message || 'Bad request', ...error }
  return Response.json({ error: errorObj } as ApiResponse, { status: 400 })
}

export function unauthorized(error: string | ApiError | Partial<ApiError>, code: ApiErrorCode = 'UNAUTHORIZED'): Response {
  const errorObj: ApiError = typeof error === 'string'
    ? { code, message: error }
    : { code: error.code || code, message: error.message || 'Unauthorized', ...error }
  return Response.json({ error: errorObj } as ApiResponse, { status: 401 })
}

export function forbidden(error: string | ApiError | Partial<ApiError>, code: ApiErrorCode = 'FORBIDDEN'): Response {
  const errorObj: ApiError = typeof error === 'string'
    ? { code, message: error }
    : { code: error.code || code, message: error.message || 'Forbidden', ...error }
  return Response.json({ error: errorObj } as ApiResponse, { status: 403 })
}

export function notFound(message = 'Not found', code: ApiErrorCode = 'NOT_FOUND'): Response {
  const error: ApiError = { code, message }
  return Response.json({ error } as ApiResponse, { status: 404 })
}

export function conflict(message: string, code: ApiErrorCode = 'CONFLICT'): Response {
  const error: ApiError = { code, message }
  return Response.json({ error } as ApiResponse, { status: 409 })
}

export function payloadTooLarge(message = 'Request body is too large', code: ApiErrorCode = 'PAYLOAD_TOO_LARGE'): Response {
  const error: ApiError = { code, message }
  return Response.json({ error } as ApiResponse, { status: 413 })
}

export function tooManyRequests(error: string | ApiError | Partial<ApiError>, headers?: Record<string, string>): Response {
  const errorObj: ApiError = typeof error === 'string'
    ? { code: 'RATE_LIMIT_EXCEEDED', message: error }
    : { code: error.code || 'RATE_LIMIT_EXCEEDED', message: error.message || 'Too many requests', ...error }

  const responseHeaders = new Headers({ 'Content-Type': 'application/json' })
  if (headers) {
    Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value))
  }

  return new Response(JSON.stringify({ error: errorObj } as ApiResponse), {
    status: 429,
    headers: responseHeaders,
  })
}

export function internalError(message = 'Internal server error', code: ApiErrorCode = 'INTERNAL_ERROR'): Response {
  const error: ApiError = { code, message }
  return Response.json({ error } as ApiResponse, { status: 500 })
}
