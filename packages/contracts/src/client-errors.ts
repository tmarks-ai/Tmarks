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
  /** Parameter properties are avoided by convention: apps/server consumes this
   * source via tsx (R8 RD-6), which accepts them — the erasable-syntax style
   * standardized under the old --experimental-strip-types mode is kept. */
  readonly code: ClientErrorCode
  readonly status: number

  constructor(code: ClientErrorCode, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
    this.name = 'ApiError'
  }
}
