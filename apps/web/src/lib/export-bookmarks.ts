import type { BookmarkDTO } from '@tmarks/contracts'

/** 导出选中书签为 Markdown 列表,返回 Blob。 */
export function exportBookmarksMarkdown(bookmarks: BookmarkDTO[], title: string): Blob {
  const lines = bookmarks.map((b) => `- [${b.title}](${b.url})`)
  const body = bookmarks.length > 0 ? `\n${lines.join('\n')}\n` : ''
  return new Blob([`# ${title}${body}`], { type: 'text/markdown;charset=utf-8' })
}

/** 触发浏览器下载 Blob(临时 anchor click + 清理)。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
