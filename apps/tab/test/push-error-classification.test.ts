import { describe, it, expect } from 'vitest'
import { classifyPushError } from '../src/lib/sync/push-errors'
import { isNonBurningSyncErrorCode } from '../src/lib/db/queue-errors'

/**
 * R8 TA-1 回归网:免费版 D1 预算超限表现为服务端 500,此前落入 network 分支
 * 烧重试预算(~40 分钟打成 exhausted 死信且不被复活)。分类与 non-burning
 * 语义两侧钉死,任一侧漂移即红。
 */
describe('classifyPushError (R8 TA-1)', () => {
  it('服务端 5xx 归 serverError,不再落入烧预算的 network 分支', () => {
    expect(classifyPushError({ code: 'INTERNAL_ERROR', status: 500, message: 'boom' })).toEqual({ kind: 'serverError', message: 'boom' })
    expect(classifyPushError({ code: 'INTERNAL_ERROR', status: 503 })).toEqual({ kind: 'serverError', message: 'Server error' })
  })

  it('SERVER_ERROR 在 non-burning 集合里:确定性 5xx 不再把队列烧成死信', () => {
    expect(isNonBurningSyncErrorCode('SERVER_ERROR')).toBe(true)
  })

  it('网络抖动(无响应/断网)仍归 network', () => {
    expect(classifyPushError({ code: 'NETWORK_ERROR', status: 0, message: 'offline' })).toEqual({ kind: 'network', message: 'offline' })
    expect(classifyPushError({ code: 'UNKNOWN_ERROR', status: 0 })).toEqual({ kind: 'network', message: 'Network request failed' })
  })

  it('限流/配额/未配源/鉴权失败保持既有分类', () => {
    expect(classifyPushError({ code: 'RATE_LIMITED', status: 429 })).toEqual({ kind: 'rateLimited', message: 'Rate limited by server' })
    expect(classifyPushError({ code: 'RATE_LIMIT_EXCEEDED', status: 400 })).toEqual({ kind: 'rateLimited', message: 'Rate limited by server' })
    expect(classifyPushError({ code: 'QUOTA_EXCEEDED', status: 400 })).toEqual({ kind: 'quota' })
    expect(classifyPushError({ code: 'INVALID_INPUT', status: 0, message: 'origin unset' })).toEqual({ kind: 'originUnset', message: 'origin unset' })
    expect(classifyPushError({ code: 'FORBIDDEN', status: 403 })).toEqual({ kind: 'forbidden' })
    expect(classifyPushError({ code: 'UNAUTHORIZED', status: 401 })).toEqual({ kind: 'forbidden' })
  })

  it('其余 4xx(非 429/401/403)保持 network 兜底语义不变', () => {
    expect(classifyPushError({ code: 'VALIDATION_FAILED', status: 400, message: 'bad' })).toEqual({ kind: 'network', message: 'bad' })
  })
})
