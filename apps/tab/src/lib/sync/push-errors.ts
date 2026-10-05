import { isForbiddenError } from './forbidden'

/**
 * push 单次批次的失败分类(sendBatch 的 catch 分支,自 push.ts 拆出):
 * 纯函数、无 IO,便于对"每种失败形态归入哪个动作"做单测钉死。
 */
export type PushBatchFailure =
  | { kind: 'forbidden' }
  | { kind: 'originUnset'; message: string }
  | { kind: 'quota' }
  | { kind: 'rateLimited'; message: string }
  | { kind: 'serverError'; message: string }
  | { kind: 'network'; message: string }

/** 把请求异常归类为 push 循环的对应动作。 */
export function classifyPushError(err: { code?: string; status?: number; message?: string }): PushBatchFailure {
  if (isForbiddenError(err)) return { kind: 'forbidden' }
  // requireOrigin 的 fail-fast 错误(INVALID_INPUT + status 0)是配置缺失,不是网络抖动——
  // 与网络错误分开归类,避免 5 分钟排空闹钟把它当瞬态故障反复重试。
  if (err.code === 'INVALID_INPUT' && err.status === 0) return { kind: 'originUnset', message: err.message ?? 'API origin is not configured' }
  if (err.code === 'QUOTA_EXCEEDED') return { kind: 'quota' }
  if (err.code === 'RATE_LIMITED' || err.code === 'RATE_LIMIT_EXCEEDED' || err.status === 429) {
    return { kind: 'rateLimited', message: err.message ?? 'Rate limited by server' }
  }
  // 服务端 5xx(如免费版 D1 每调用 50 查询预算被 push 批次击穿,R8 BL-1/TA-1):
  // 与网络抖动分开归类——markFailed 对 SERVER_ERROR 走 non-burning 语义保留
  // 重试预算;此前落入 network 分支烧预算,确定性 500 在 ~40 分钟内就把整批
  // 打成 exhausted 死信,且 exhausted 不会被 queue-repair 复活。
  if (typeof err.status === 'number' && err.status >= 500) {
    return { kind: 'serverError', message: err.message ?? 'Server error' }
  }
  if (err.code === 'NETWORK_ERROR' || err.status === 0) return { kind: 'network', message: err.message ?? 'Network request failed' }
  return { kind: 'network', message: err.message ?? 'Sync push failed' }
}
