import { ApiError } from './api-error'

const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 15000)

function getRequestTimeoutMs(): number {
  return Number.isFinite(API_TIMEOUT_MS) && API_TIMEOUT_MS > 0 ? API_TIMEOUT_MS : 15000
}

export async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const timeoutMs = getRequestTimeoutMs()
  const controller = new AbortController()
  const originalSignal = options.signal

  const abortFromOriginalSignal = () => controller.abort()
  if (originalSignal?.aborted) {
    controller.abort()
  } else {
    originalSignal?.addEventListener('abort', abortFromOriginalSignal, { once: true })
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    if (controller.signal.aborted && !originalSignal?.aborted) {
      throw new ApiError(
        'REQUEST_TIMEOUT',
        `Request timed out after ${Math.round(timeoutMs / 1000)}s`,
        0,
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
    originalSignal?.removeEventListener('abort', abortFromOriginalSignal)
  }
}
