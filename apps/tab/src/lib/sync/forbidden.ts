/**
 * 共享鉴权失败判定(RC-E):push 与 pull 共用同一实现,避免双份不一致
 * (此前 pull.ts 漏判 401,导致登录态过期时 pull 误把 401 当普通错误而非 forbidden)。
 */
export function isForbiddenError(error: unknown): boolean {
  const value = error as { code?: string; status?: number }
  return value.status === 401 || value.status === 403
    || value.code === 'FORBIDDEN' || value.code === 'PERMISSION_DENIED' || value.code === 'UNAUTHORIZED'
}
