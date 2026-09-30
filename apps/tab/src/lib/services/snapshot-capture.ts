export interface CapturedSnapshot {
  title: string
  url: string
  html_content: string
}

/** Ask the content script for a static, script-free DOM snapshot (经 background 兜底 executeScript)。 */
export async function captureCurrentPage(tabId: number | undefined): Promise<CapturedSnapshot> {
  if (tabId == null) throw new Error('No active tab')
  const response = await chrome.runtime.sendMessage({ type: 'CAPTURE_PAGE_BG', tabId }).catch(() => null) as CapturedSnapshot | null
  if (!response?.html_content) throw new Error('Page capture is unavailable on this page')
  return response
}
