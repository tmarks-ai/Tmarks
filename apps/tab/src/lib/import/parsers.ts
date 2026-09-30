import { normalizeImportBookmark, type ImportBookmarkDraft, type ImportParseError, type ImportParseResult } from './types'

export function parseImportFile(text: string, fileName = ''): ImportParseResult {
  const extension = fileName.toLowerCase().split('.').pop()
  if (extension === 'html' || extension === 'htm' || /<\s*dt\b/i.test(text)) return parseBookmarksHtml(text)
  if (extension === 'txt') return parseTextUrls(text)
  if (extension === 'csv') return parseCsvUrls(text)
  return parseBookmarksJson(text)
}

export function parseBookmarksHtml(text: string): ImportParseResult {
  const items: ImportBookmarkDraft[] = []
  const errors: ImportParseError[] = []
  const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null

  if (parser) {
    const document = parser.parseFromString(text, 'text/html')
    // RC-G:递归遍历 <dl> 子树保留层级。此前 querySelectorAll('h3, a') 扁平遍历 +
    // 依赖 data-level 属性弹栈,而标准导出器不输出 data-level → folderStack 永不弹,
    // 后续书签全误入最深文件夹。Netscape 格式是严格 <dl><dt><h3>..<dl> / <dt><a> 嵌套,
    // 递归天然还原层级。
    const state = { index: 0 }
    const rootDl = document.querySelector('dl')
    if (rootDl) walkDl(rootDl, items, errors, state)
    return { source: 'html', items, errors }
  }

  const linkPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  let index = 0
  while ((match = linkPattern.exec(text))) {
    const draft = normalizeImportBookmark({ url: decodeHtml(match[1] ?? ''), title: stripHtml(match[2] ?? '') }, index, 'html')
    if (draft) items.push(draft)
    else errors.push({ sourceIndex: index, message: 'Unsupported URL', value: match[1] })
    index++
  }
  return { source: 'html', items, errors }
}

export function parseBookmarksJson(text: string): ImportParseResult {
  try {
    const parsed = JSON.parse(text) as unknown
    const candidates = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.bookmarks)
        ? parsed.bookmarks
        : isRecord(parsed) && Array.isArray(parsed.items)
          ? parsed.items
          : []
    const items: ImportBookmarkDraft[] = []
    const errors: ImportParseError[] = []
    candidates.forEach((candidate, index) => {
      const value = isRecord(candidate) ? candidate : {}
      const draft = normalizeImportBookmark({
        url: asString(value.url),
        title: asString(value.title ?? value.name),
        description: asString(value.description),
        folderPath: asStringList(value.folderPath ?? value.folder_path ?? value.folder, /[\\/]+/),
        tags: asStringList(value.tags ?? value.tag_names, /[,;]+/),
      }, index, 'json')
      if (draft) items.push(draft)
      else errors.push({ sourceIndex: index, message: 'Invalid bookmark URL', value: String(value.url ?? '') })
    })
    return { source: 'json', items, errors }
  } catch {
    return { source: 'json', items: [], errors: [{ sourceIndex: 0, message: 'Invalid JSON' }] }
  }
}

export function parseTextUrls(text: string): ImportParseResult {
  const items: ImportBookmarkDraft[] = []
  const errors: ImportParseError[] = []
  text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach((line, index) => {
    const [url, ...titleParts] = line.split(/\s+/)
    const draft = normalizeImportBookmark({ url, title: titleParts.join(' ') || url }, index, 'text')
    if (draft) items.push(draft)
    else errors.push({ sourceIndex: index, message: 'Invalid bookmark URL', value: line })
  })
  return { source: 'text', items, errors }
}

/**
 * CSV 解析:支持带表头(title,url 或 url,title)、无表头两列(自动判断哪列是
 * URL)、以及带引号的字段(引号内的逗号不会被切开)。单列时按纯 URL 行处理。
 */
export function parseCsvUrls(text: string): ImportParseResult {
  const items: ImportBookmarkDraft[] = []
  const errors: ImportParseError[] = []
  const records = text
    .split(/\r?\n/)
    .map(splitCsvLine)
    .filter((cells) => cells.some((cell) => cell.length > 0))

  if (records.length === 0) return { source: 'text', items, errors }

  const header = detectCsvHeader(records[0] || [])
  const start = header ? 1 : 0

  for (let rowIndex = start; rowIndex < records.length; rowIndex += 1) {
    const { url, title } = resolveCsvCells(records[rowIndex] || [], header)
    const draft = normalizeImportBookmark({ url, title }, rowIndex, 'text')
    if (draft) items.push(draft)
    else errors.push({ sourceIndex: rowIndex, message: 'Invalid bookmark URL', value: (records[rowIndex] || []).join(',') })
  }
  return { source: 'text', items, errors }
}

/** 识别表头行(含 url/link/href 与 title/name 两列),返回列索引;非表头返回 null。 */
function detectCsvHeader(cells: string[]): { url: number; title: number } | null {
  if (cells.length < 2) return null
  const urlIndex = cells.findIndex((cell) => /^(url|link|href|address)$/i.test(cell.trim()))
  const titleIndex = cells.findIndex((cell) => /^(title|name)$/i.test(cell.trim()))
  if (urlIndex === -1 || titleIndex === -1) return null
  return { url: urlIndex, title: titleIndex }
}

/** 按表头或启发式(哪列长得像 URL)取 url/title。 */
function resolveCsvCells(
  cells: string[],
  header: { url: number; title: number } | null
): { url: string; title: string } {
  if (header) {
    return { url: cells[header.url]?.trim() || '', title: cells[header.title]?.trim() || '' }
  }
  if (cells.length === 1) return { url: (cells[0] || '').trim(), title: '' }
  if (/^https?:\/\//i.test(cells[0]?.trim() || '')) return { url: cells[0].trim(), title: (cells[1] || '').trim() }
  if (/^https?:\/\//i.test(cells[1]?.trim() || '')) return { url: cells[1].trim(), title: (cells[0] || '').trim() }
  // 两列都不像 URL:按 (title, url) 处理,由 normalizeImportBookmark 校验 URL。
  return { url: (cells[1] || '').trim(), title: (cells[0] || '').trim() }
}

/** 切开一行 CSV,支持双引号包裹字段(引号内逗号保留,双引号转义)。 */
function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  cells.push(current.trim())
  return cells
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asStringList(value: unknown, separator: RegExp): string[] | undefined {
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value as string[]
  if (typeof value === 'string') return value.split(separator).filter(Boolean)
  return undefined
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function decodeHtml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

/** 通用书签树节点(与 DOM 解耦,便于在无 DOMParser 的 node 测试环境直接单测)。 */
export interface BookmarkTreeNode {
  tag: string
  text?: string | null
  href?: string | null
  children: BookmarkTreeNode[]
}

/**
 * 纯函数递归遍历(RC-G):对每个 <dt>,若含 <h3> 视为文件夹(push 栈 → 递归其 <dl> → pop),
 * 若含 <a> 视为书签归入当前栈顶文件夹。嵌套 <dl> 既可能是 <dt> 的直接子,
 * 也可能是 <dt> 的后续兄弟(不同 HTML 解析器/导出器差异),两者均支持。
 * 替代此前 querySelectorAll('h3,a') 扁平遍历 + data-level 弹栈(标准导出不输出 data-level → 误归层)。
 */
export function traverseBookmarksTree(root: BookmarkTreeNode, emit: (url: string, title: string | undefined, folderPath: string[]) => void): void {
  const stack: string[] = []
  walk(root, stack, emit)
}

/** 嵌套深度上限:恶意/畸形导出文件可用深层嵌套 <dl> 打爆递归栈。 */
const MAX_WALK_DEPTH = 32

function walk(dl: BookmarkTreeNode, stack: string[], emit: (url: string, title: string | undefined, folderPath: string[]) => void): void {
  if (stack.length >= MAX_WALK_DEPTH) return
  const kids = dl.children
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i]
    if (node.tag !== 'dt') continue
    const h3 = node.children.find((c) => c.tag === 'h3')
    if (h3) {
      const name = (h3.text ?? '').trim() || 'Imported'
      stack.push(name)
      let nested = node.children.find((c) => c.tag === 'dl')
      if (!nested) {
        for (let j = i + 1; j < kids.length; j++) {
          if (kids[j].tag === 'dt') break
          if (kids[j].tag === 'dl') { nested = kids[j]; break }
        }
      }
      if (nested) walk(nested, stack, emit)
      stack.pop()
      continue
    }
    const a = node.children.find((c) => c.tag === 'a')
    if (a) emit(a.href ?? '', a.text ?? undefined, [...stack])
  }
}

/**
 * DOM 映射深度上限:MAX_WALK_DEPTH 只保护其后的语义 walk,而这个 DOM→树的
 * 映射本身是递归——畸形深层嵌套 HTML 会在护栏生效前先打爆映射栈。真实
 * 导出(每层文件夹约 3 个 DOM 层)远用不到 128 层,超出即静默截断。
 */
const MAX_DOM_MAP_DEPTH = 128

/** DOM 元素 → BookmarkTreeNode(保留层级;仅映射结构,无 DOMParser 时不调用)。 */
function toTreeNode(el: Element, depth: number): BookmarkTreeNode {
  const tag = el.tagName.toLowerCase()
  return {
    tag,
    text: tag === 'h3' || tag === 'a' ? el.textContent ?? null : undefined,
    href: el.getAttribute('href'),
    children: depth <= 0
      ? []
      : Array.from(el.children).map((child) => toTreeNode(child, depth - 1)),
  }
}

/** 递归遍历 <dl>:委托纯函数 traverseBookmarksTree(经 toTreeNode 映射)。 */
function walkDl(rootDl: Element, items: ImportBookmarkDraft[], errors: ImportParseError[], state: { index: number }): void {
  const tree = toTreeNode(rootDl, MAX_DOM_MAP_DEPTH)
  traverseBookmarksTree(tree, (url, title, folderPath) => {
    const draft = normalizeImportBookmark({ url, title, folderPath }, state.index, 'html')
    if (draft) items.push(draft)
    else if (url) errors.push({ sourceIndex: state.index, message: 'Unsupported URL', value: url })
    state.index++
  })
}
