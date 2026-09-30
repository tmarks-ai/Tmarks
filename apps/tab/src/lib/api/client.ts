import type { ApiResponse } from '@tmarks/contracts'
import { getApiOrigin } from './config'
import { getAuthHeaders } from './auth'
import { ApiError, type ClientErrorCode } from './error'

function isApiFailure<T>(response: ApiResponse<T>): response is Extract<ApiResponse<T>, { error: unknown }> {
  return 'error' in response
}

function isApiSuccess<T>(response: ApiResponse<T>): response is Extract<ApiResponse<T>, { data: unknown }> {
  return 'data' in response
}

/**
 * 扩展端 HttpClient:fetch 到 API 源 + X-API-Key 鉴权头,
 * 204 返回空,非 2xx 抛 ApiError(带服务器 error.code/message)。
 */
export class HttpClient {
  /** origin 未配置(空串)时 fail-fast:不发请求、不带 API key。 */
  private async requireOrigin(): Promise<string> {
    const origin = await getApiOrigin()
    if (!origin) {
      throw new ApiError(
        'INVALID_INPUT',
        'API server address is not configured — set it on the options page first',
        0,
      )
    }
    return origin
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<ApiResponse<T>> {
    const origin = await this.requireOrigin()
    const headers = new Headers(init.headers)
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const auth = await getAuthHeaders()
    for (const [k, v] of Object.entries(auth)) headers.set(k, v)

    let res: Response
    try {
      res = await fetch(`${origin}${path}`, { ...init, headers })
    } catch (e) {
      throw new ApiError('NETWORK_ERROR', e instanceof Error ? e.message : 'Network request failed', 0)
    }

    if (res.status === 204) return {} as ApiResponse<T>

    const text = await res.text().catch(() => '')
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        throw new ApiError('INVALID_RESPONSE', 'Failed to parse server response', res.status)
      }
    }

    if (!res.ok) {
      const err = (data as { error?: { code: ClientErrorCode; message: string } | null } | null)?.error
      throw new ApiError(err?.code ?? 'UNKNOWN_ERROR', err?.message ?? 'Request failed', res.status)
    }
    return (data ?? {}) as ApiResponse<T>
  }

  get<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...init, method: 'GET' })
  }
  post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
  }
  patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
  }
  delete<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>(path, { method: 'DELETE' })
  }

  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const origin = await this.requireOrigin()
    const headers = new Headers(init.headers)
    const auth = await getAuthHeaders()
    for (const [key, value] of Object.entries(auth)) headers.set(key, value)
    return fetch(`${origin}${path}`, { ...init, headers })
  }
}

export const apiClient = new HttpClient()

/** 解包 ApiResponse:成功返回 data,失败抛 ApiError。 */
export async function unwrapData<T>(res: ApiResponse<T>, context: string): Promise<T> {
  if (isApiSuccess(res)) return res.data
  if (isApiFailure(res)) throw new ApiError(res.error.code, res.error.message, 0)
  throw new ApiError('EMPTY_RESPONSE', `Unexpected empty response from ${context}`, 0)
}
