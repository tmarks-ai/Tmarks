import { describe, expect, it, vi } from 'vitest'
import { describeMutationError } from '@/lib/describe-error'
import { ApiError } from '@/lib/api-error'

/**
 * describeMutationError is the single funnel every mutation failure passes
 * through on its way to a user-visible toast — an unhelpful or wrong mapping
 * here is indistinguishable from the mutation itself failing.
 */
const t = (key: string) => key

describe('describeMutationError', () => {
  it('returns the generic fallback for non-Error values', () => {
    expect(describeMutationError('string', t)).toBe('message.operationFailed')
    expect(describeMutationError(null, t)).toBe('message.operationFailed')
    expect(describeMutationError(undefined, t)).toBe('message.operationFailed')
  })

  it('uses the raw message of a plain Error (not an ApiError)', () => {
    expect(describeMutationError(new Error('Custom failure'), t)).toBe('Custom failure')
  })

  it('prefers the server-provided specific message over status-based fallbacks', () => {
    const error = new ApiError('VALIDATION_FAILED', 'Tag name must be 2-50 chars', 400)
    expect(describeMutationError(error, t)).toBe('Tag name must be 2-50 chars')
  })

  it('falls back to a status-aware hint for generic server messages', () => {
    const generic = new ApiError('UNKNOWN_ERROR', 'An error occurred', 500)
    expect(describeMutationError(generic, t)).toBe('message.serverError')
  })

  it('maps each status code to the right user hint when the server message is generic', () => {
    const cases: Array<[ApiError, string]> = [
      [new ApiError('UNAUTHORIZED', 'Unauthorized', 401), 'message.sessionExpired'],
      [new ApiError('FORBIDDEN', 'An error occurred', 403), 'message.forbidden'],
      [new ApiError('NOT_FOUND', 'An error occurred', 404), 'message.notFound'],
      [new ApiError('CONFLICT', 'An error occurred', 409), 'message.conflict'],
      [new ApiError('RATE_LIMIT_EXCEEDED', 'An error occurred', 429), 'message.rateLimited'],
      [new ApiError('INTERNAL_ERROR', 'An error occurred', 500), 'message.serverError'],
      [new ApiError('BAD_REQUEST', 'An error occurred', 400), 'message.operationFailed'],
    ]
    for (const [error, expected] of cases) {
      expect(describeMutationError(error, t)).toBe(expected)
    }
  })

  it('distinguishes network timeout from a generic network error at status 0', () => {
    expect(describeMutationError(new ApiError('REQUEST_TIMEOUT', 'Network request failed', 0), t))
      .toBe('message.timeout')
    expect(describeMutationError(new ApiError('NETWORK_ERROR', 'Network request failed', 0), t))
      .toBe('message.networkError')
  })
})
