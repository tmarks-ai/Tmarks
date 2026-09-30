import type { ApiResponse } from './types'
import { logger } from './logger'
import { ApiError, type ClientErrorCode } from './api-error'
import { fetchWithTimeout } from './fetch-with-timeout'

/**
 * Auth surface injected by the caller (api-client.ts). Breaks the circular
 * dependency: http-client ← authStore ← auth service ← api-client ←
 * http-client. With a direct import of useAuthStore, ESM's hoisted module
 * evaluation hit `new HttpClient()` in api-client before the class definition
 * had run — "HttpClient is not a constructor" in vitest/jsdom.
 */
export interface AuthDelegate {
  getAccessToken(): string | null
  refresh(): Promise<void>
  onAuthFailure(): void
}

let isRefreshing = false
let refreshSubscribers: Array<{
  resolve: (token: string) => void
  reject: (error: Error) => void
}> = []

function subscribeToRefresh(): { promise: Promise<string>; unsubscribe: () => void } {
  let entry: { resolve: (token: string) => void; reject: (error: Error) => void }
  const promise = new Promise<string>((resolve, reject) => {
    entry = { resolve, reject }
    refreshSubscribers.push(entry)
  })
  const unsubscribe = () => {
    refreshSubscribers = refreshSubscribers.filter(e => e !== entry)
  }
  return { promise, unsubscribe }
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach(({ resolve }) => resolve(token))
  refreshSubscribers = []
}

function rejectSubscribers(error: Error) {
  refreshSubscribers.forEach(({ reject }) => reject(error))
  refreshSubscribers = []
}

export class HttpClient {
  private baseURL: string
  private readonly useAuth: boolean
  private auth: AuthDelegate | null = null

  constructor(baseURL: string, useAuth = true) {
    this.baseURL = baseURL
    this.useAuth = useAuth
  }

  /** Wire the auth store after construction (breaks the import cycle). */
  bindAuth(delegate: AuthDelegate): void {
    this.auth = delegate
  }

  private getAccessToken(): string | null {
    return this.useAuth ? this.auth?.getAccessToken() ?? null : null
  }

  private async refreshAfter401(): Promise<string> {
    if (!isRefreshing) {
      isRefreshing = true
      try {
        await this.auth!.refresh()
        const newToken = this.auth!.getAccessToken()
        if (newToken) {
          onRefreshed(newToken)
          return newToken
        }
        throw new Error('Failed to get new token after refresh')
      } catch (error) {
        const err = error instanceof Error ? error : new Error('Token refresh failed')
        rejectSubscribers(err)
        this.clearAuthAndRedirect()
        logger.error('Token refresh failed:', err)
        throw error
      } finally {
        isRefreshing = false
      }
    }

    const { promise, unsubscribe } = subscribeToRefresh()
    let timeoutId: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        unsubscribe()
        reject(new Error('Token refresh timeout'))
      }, 10000)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
  }

  private buildHeaders(options: RequestInit, accessToken: string): Headers {
    const headers = new Headers(options.headers)

    if (options.body !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    if (accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${accessToken}`)
    }

    return headers
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseURL}${endpoint}`
    let accessToken = this.getAccessToken()

    const makeRequest = async (token: string) => fetchWithTimeout(url, {
      ...options,
      credentials: 'include',
      headers: this.buildHeaders(options, token),
    })

    try {
      let response = await makeRequest(accessToken || '')

      if (this.useAuth && response.status === 401 && !endpoint.startsWith('/auth/')) {
        try {
          const newToken = await this.refreshAfter401()
          if (newToken) {
            accessToken = newToken
            response = await makeRequest(accessToken)
          }
        } catch {
          let data: { error?: { code: ClientErrorCode; message: string } } = { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }
          try {
            const text = await response.text()
            if (text) {
              const parsed = JSON.parse(text) as { error?: { code: ClientErrorCode; message: string } }
              data = parsed
            }
          } catch {
            // use default error
          }
          const apiError = data.error || { code: 'UNAUTHORIZED', message: 'Unauthorized' }
          throw new ApiError(apiError.code, apiError.message, response.status)
        }
      }

      if (response.status === 204) {
        return {} as ApiResponse<T>
      }

      let data: unknown
      try {
        const text = await response.text()
        if (!text || text.trim() === '') {
          if (!response.ok) {
            throw new ApiError('EMPTY_RESPONSE', 'Server returned empty response', response.status)
          }
          return {} as ApiResponse<T>
        }
        data = JSON.parse(text) as unknown
      } catch (parseError) {
        if (parseError instanceof ApiError) {
          throw parseError
        }
        throw new ApiError(
          'INVALID_RESPONSE',
          `Failed to parse server response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`,
          response.status
        )
      }

      if (!response.ok) {
        const errorData = data as { error?: { code: ClientErrorCode; message: string } }
        const error = errorData.error || { code: 'UNKNOWN_ERROR', message: 'An error occurred' }
        throw new ApiError(error.code, error.message, response.status)
      }

      return data as ApiResponse<T>
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }

      throw new ApiError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network request failed',
        0
      )
    }
  }

  private clearAuthAndRedirect() {
    this.auth?.onAuthFailure()
  }

  async get<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'GET' })
  }

  async raw(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const url = `${this.baseURL}${endpoint}`
    let accessToken = this.getAccessToken()

    const makeRequest = async (token: string) => fetchWithTimeout(url, {
      ...options,
      credentials: 'include',
      headers: this.buildHeaders(options, token),
    })

    try {
      let response = await makeRequest(accessToken || '')
      if (this.useAuth && response.status === 401 && !endpoint.startsWith('/auth/')) {
        try {
          accessToken = await this.refreshAfter401()
          response = await makeRequest(accessToken)
        } catch {
          return response
        }
      }
      return response
    } catch (error) {
      if (error instanceof ApiError) {
        throw error
      }
      throw new ApiError(
        'NETWORK_ERROR',
        error instanceof Error ? error.message : 'Network request failed',
        0
      )
    }
  }

  async post<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  async put<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  async patch<T>(endpoint: string, body?: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  async delete<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' })
  }
}
