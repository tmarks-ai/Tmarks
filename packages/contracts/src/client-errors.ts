import type { ApiErrorCode } from './errors'

/**
 * Failure modes produced by the client itself rather than returned by the API.
 *
 * This lived separately in apps/web and apps/tab and had already drifted — web
 * knew REQUEST_TIMEOUT, the extension knew NETWORK_ERROR (which is in fact a
 * server code) — while both matched against the same `error.code` values. One
 * definition keeps the two clients able to handle each other's cases.
 */
export type LocalErrorCode =
  | 'EMPTY_RESPONSE'
  | 'INVALID_RESPONSE'
  | 'REQUEST_TIMEOUT'
  | 'UNKNOWN_ERROR'

export type ClientErrorCode = ApiErrorCode | LocalErrorCode

/** API error carrying the server (or client-local) code plus the HTTP status. */
export class ApiError extends Error {
  constructor(
    public code: ClientErrorCode,
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}
