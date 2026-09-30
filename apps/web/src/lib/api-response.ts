import { isApiSuccess, isApiFailure } from '@tmarks/contracts'
import type { ApiResponse } from '@tmarks/contracts'
import { ApiError } from './api-error'

/**
 * 解包 ApiResponse:成功返回 data,失败抛 ApiError,空响应(204)抛 EMPTY_RESPONSE。
 * 用于需要取 data 的 service 调用;无需取 data 的(如 logout)直接 await。
 */
export function unwrapData<T>(response: ApiResponse<T>, context: string): T {
  if (isApiSuccess(response)) return response.data
  if (isApiFailure(response)) {
    throw new ApiError(response.error.code, response.error.message, 0)
  }
  throw new ApiError('EMPTY_RESPONSE', `Unexpected empty response from ${context}`, 0)
}
