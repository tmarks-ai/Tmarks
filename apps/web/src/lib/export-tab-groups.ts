import type { TabGroupDTO } from '@tmarks/contracts'

/** 导出选中条目为 Markdown(按组分组),返回 Blob。 */
export function exportTabGroupsMarkdown(allGroups: TabGroupDTO[], selectedIds: string[], title: string): Blob {
  const selectedSet = new Set(selectedIds)
  const sections: string[] = []
  allGroups.forEach((group) => {
    const items = (group.items || []).filter((item) => selectedSet.has(item.id))
    if (items.length === 0) return
    sections.push(`## ${group.title}\n\n${items.map((item) => `- [${item.title}](${item.url})`).join('\n')}`)
  })
  return new Blob([`# ${title}\n\n${sections.join('\n\n')}`], { type: 'text/markdown;charset=utf-8' })
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
