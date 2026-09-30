import { useEffect } from 'react'

/**
 * 页面级 document.title(本地化):标签页标题此前是静态中文,英文界面永远
 * 显示中文标签。每个路由挂载时覆盖,SPA 内切换即生效。
 */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    if (!title) return
    document.title = `${title} · TMarks`
  }, [title])
}