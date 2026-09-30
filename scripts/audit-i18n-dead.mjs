import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// apps/web/src relative to this script — portable across checkouts.
const ROOT = fileURLToPath(new URL('../apps/web/src', import.meta.url)).replace(/[\\/]+$/, '')
const LOCALE_DIR = path.join(ROOT, 'i18n/locales')
const DEFAULT_NS = 'common'

// ---- 1. Load defined keys per namespace (en canonical) ----
const nsKeys = {}
function walk(obj, prefix, out) {
  for (const k of Object.keys(obj)) {
    const v = obj[k]
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p, out)
    else out.add(p)
  }
}
function loadNs(ns, ...files) {
  const set = new Set()
  for (const f of files) {
    const fp = path.join(LOCALE_DIR, 'en', f)
    if (!fs.existsSync(fp)) continue
    walk(JSON.parse(fs.readFileSync(fp, 'utf8')), '', set)
  }
  nsKeys[ns] = set
}
loadNs('common', 'common.json')
loadNs('auth', 'auth.json')
loadNs('bookmarks', 'bookmarks.json')
loadNs('tags', 'tags.json')
loadNs('settings', 'settings/api.json', 'settings/basic.json', 'settings/browser.json', 'settings/core.json', 'settings/data.json', 'settings/language.json', 'settings/public-share.json', 'settings/sync-health.json', 'settings/workspace.json')
loadNs('tabGroups', 'tabGroups/core.json', 'tabGroups/organization.json', 'tabGroups/views.json')
const ALL_NS = Object.keys(nsKeys)

// ---- 2. effective namespace(s) per source file ----
const SHARED_ALL = new Set([
  'components/common/ConfirmDialog.tsx', 'components/common/InputDialog.tsx',
  'components/common/DialogHost.tsx', 'components/common/Toast.tsx',
  'components/common/PaginationFooter.tsx', 'components/common/ThemeToggle.tsx',
  'components/common/SearchToolbar.tsx', 'components/common/ErrorBoundary.tsx',
  'components/layout/ShellHeaderRight.tsx', 'components/layout/FullScreenAppShell.tsx',
  'components/layout/PublicShareShell.tsx', 'components/layout/MobileBottomNav.tsx',
])
const DYNAMIC_NS = {
  'components/bookmarks/workspace/BookmarkWorkspaceLayout.tsx': ['bookmarks'],
  'components/tab-groups/PinnedItemsSection.tsx': ['tabGroups'],
  'components/common/SearchToolbar.tsx': ['bookmarks', 'tabGroups'],
  'components/tab-groups/EmptyState.tsx': ['tabGroups'],
  'components/tab-groups/tree/TabGroupTree.tsx': ['tabGroups'],
  'components/tab-groups/workspace/TabGroupWorkspaceLayout.tsx': ['tabGroups'],
  'components/tab-groups/grid/TabItemList.tsx': ['tabGroups'],
  'components/tab-groups/grid/TabGroupHeader.tsx': ['tabGroups'],
  'components/tab-groups/grid/TabGroupsGrid.tsx': ['tabGroups'],
  'components/tab-groups/grid/TabItemRow.tsx': ['tabGroups'],
  'components/bookmarks/PinnedBookmarksSection.tsx': ['bookmarks'],
  'components/tab-groups/tree/TabGroupTreeNode.tsx': ['tabGroups'],
}
function rel(p) { return path.relative(ROOT, p).replace(/\\/g, '/') }
function effectiveNs(r, content) {
  if (SHARED_ALL.has(r)) return ALL_NS
  if (DYNAMIC_NS[r]) return DYNAMIC_NS[r]
  const lit = [...content.matchAll(/useTranslation\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1])
  if (lit.length) return lit
  if (/useTranslation\(\s*\)/.test(content)) return [DEFAULT_NS]
  // prop-t / no useTranslation: directory heuristics
  if (r.startsWith('pages/auth/')) return ['auth']
  if (r.startsWith('components/tags/')) return ['tags']
  if (r.startsWith('components/bookmarks/') || r.startsWith('pages/bookmarks/') || r.startsWith('pages/public/')) return ['bookmarks']
  if (r.startsWith('components/tab-groups/') || r.startsWith('pages/tab-groups/')) return ['tabGroups']
  if (r.startsWith('pages/settings/')) return ['settings']
  if (r.startsWith('components/layout/') || r.startsWith('components/common/')) return ALL_NS
  return ALL_NS // unknown -> conservative
}

// ---- 3. collect live keys by scanning ALL string literals per file ----
const live = new Set()
function addLive(ns, key) { if (nsKeys[ns]?.has(key)) live.add(`${ns}.${key}`) }
function resolveLiteral(nsList, L) {
  if (!L || /\s/.test(L) || L.length > 120) return
  // colon form ns:path
  const ci = L.indexOf(':')
  if (ci > 0 && /^[a-zA-Z]\w*$/.test(L.slice(0, ci))) {
    addLive(L.slice(0, ci), L.slice(ci + 1))
    return
  }
  // template literal with interpolation: prefix.*
  if (L.includes('${')) {
    const prefix = L.slice(0, L.indexOf('${')).replace(/\.$/, '')
    if (/^[a-zA-Z][\w.]*$/.test(prefix)) {
      for (const ns of nsList) for (const k of nsKeys[ns] || []) if (k === prefix || k.startsWith(prefix + '.')) live.add(`${ns}.${k}`)
    }
    return
  }
  // dotted path
  if (/^[a-zA-Z][\w.]*$/.test(L)) {
    for (const ns of nsList) addLive(ns, L)
  }
}

function listFiles(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listFiles(p, out)
    else if (/\.[tj]sx?$|\.json$/.test(e.name)) out.push(p)
  }
}
const allFiles = []
listFiles(ROOT, allFiles)
const srcFiles = allFiles.filter(f => !rel(f).startsWith('i18n/'))

const litRe = /(['"`])([^'"`\n]{1,120})\1/g
for (const f of srcFiles) {
  const content = fs.readFileSync(f, 'utf8')
  const nsList = effectiveNs(rel(f), content)
  let m
  litRe.lastIndex = 0
  while ((m = litRe.exec(content))) resolveLiteral(nsList, m[2])
}

// ---- 4. dead ----
const deadByNs = {}
let total = 0, deadTotal = 0
for (const ns of ALL_NS) {
  total += nsKeys[ns].size
  const dead = [...nsKeys[ns]].filter(k => !live.has(`${ns}.${k}`))
  deadByNs[ns] = dead
  deadTotal += dead.length
}
console.log(`# Defined: ${total} | Live: ${live.size} | DEAD: ${deadTotal}`)
for (const ns of ALL_NS) if (deadByNs[ns].length) {
  console.log(`\n## ${ns} (${deadByNs[ns].length})`)
  for (const k of deadByNs[ns]) console.log(`${ns}.${k}`)
}
fs.writeFileSync(path.join(LOCALE_DIR, '.dead-keys.json'), JSON.stringify(deadByNs, null, 2))
console.log(`\nWrote .dead-keys.json`)
