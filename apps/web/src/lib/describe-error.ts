import { ApiError } from './api-error'

/**
 * Map an unknown thrown value to a user-actionable toast string.
 * Prefers the server-provided error.message when it's specific (not the
 * generic 'An error occurred'), otherwise falls back to a status-aware hint
 * so users know whether to re-login, retry, or wait.
 */
export function describeMutationError(error: unknown, t: (key: string) => string): string {
  if (!(error instanceof Error)) return t('message.operationFailed')
  if (!(error instanceof ApiError)) return error.message || t('message.operationFailed')

  // Server-provided specific message beats generic fallbacks.
  const knownGeneric = new Set(['An error occurred', 'Network request failed', 'Unauthorized'])
  if (error.message && !knownGeneric.has(error.message)) return error.message

  switch (error.status) {
    case 401:
      return t('message.sessionExpired')
    case 403:
      return t('message.forbidden')
    case 404:
      return t('message.notFound')
    case 409:
      return t('message.conflict')
    case 429:
      return t('message.rateLimited')
    case 0:
      return 'code' in error && error.code === 'REQUEST_TIMEOUT' ? t('message.timeout') : t('message.networkError')
    default:
      if (error.status >= 500) return t('message.serverError')
      return t('message.operationFailed')
  }
}
