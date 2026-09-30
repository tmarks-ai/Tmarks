import type { ApiErrorCode } from './errors'

/**
 * 顶层分页 meta。实际线上几乎不用(分页 meta 嵌在 `data.meta` 内,见各 per-route
 * 响应 DTO);此处保留为 `success(data, meta?)` 的第二参数类型,字段对齐
 * `backend-core/src/lib/types.ts` 的 ApiResponse['meta']。
 */
interface PageMeta {
  page?: number
  page_size?: number
  total?: number
  next_cursor?: string | null
}

interface ApiSuccess<T> {
  data: T
  meta?: PageMeta
}

interface ApiFailure {
  error: {
    code: ApiErrorCode
    message: string
    details?: unknown
  }
  meta?: PageMeta
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

export function isApiFailure<T>(response: ApiResponse<T>): response is ApiFailure {
  return 'error' in response
}

export function isApiSuccess<T>(response: ApiResponse<T>): response is ApiSuccess<T> {
  return 'data' in response
}
