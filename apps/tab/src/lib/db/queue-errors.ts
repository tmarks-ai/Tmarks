/**
 * 同步队列的错误码语义(自 queue.ts 拆出):哪些服务端拒绝是终态、哪些失败
 * 不烧重试预算。判定只看 code 字符串,与存储/网络解耦,便于单测。
 */

/** 服务端拒绝后重推永远不会成功的终态码:立即 exhausted,靠"接受远端"恢复。 */
export const TERMINAL_SYNC_REJECT_CODES = new Set([
  'DUPLICATE_URL',
  'TAG_EXISTS',
  'VALIDATION_FAILED',
  'OWNERSHIP_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'UNSUPPORTED_ENTITY',
  'UNSUPPORTED_OPERATION',
  'SCHEMA_UNSUPPORTED',
  // 自父/成环的父级关系,重推永远不会成功——立即终态,靠"接受远端"恢复。
  'INVALID_PARENT_TREE',
])

export function isTerminalSyncRejectCode(code: string | null | undefined): boolean {
  return Boolean(code && TERMINAL_SYNC_REJECT_CODES.has(code))
}

/**
 * 不烧重试预算的错误码:FORBIDDEN(密钥失效)、ORIGIN_UNSET(未配源)、
 * RATE_LIMITED、QUOTA_EXCEEDED 都是"外部状态"问题——重试条目本身没有
 * 意义,修好凭据/限流窗口后自然恢复。若计入 MAX_SYNC_RETRIES,排空闹钟
 * 每 5 分钟烧一次,~40 分钟就把整个队列打成 exhausted 死信,而恢复只能
 * 逐条手动。
 */
export const NON_BURNING_ERROR_CODES = new Set([
  'FORBIDDEN',
  'ORIGIN_UNSET',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'IDEMPOTENCY_IN_PROGRESS',
])

export function isNonBurningSyncErrorCode(code: string | null | undefined): boolean {
  return Boolean(code && NON_BURNING_ERROR_CODES.has(code))
}
