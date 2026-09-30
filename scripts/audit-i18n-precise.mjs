import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// apps/web/src relative to this script — portable across checkouts.
const ROOT=fileURLToPath(new URL('../apps/web/src', import.meta.url)).replace(/[\\/]+$/,'')
const LOCALE_DIR=path.join(ROOT,'i18n/locales'); const DEFAULT_NS='common'
const nsKeys={}; function walk(o,p,out){for(const k of Object.keys(o)){const v=o[k],pp=p?`${p}.${k}`:k;if(v&&typeof v==='object'&&!Array.isArray(v))walk(v,pp,out);else out.add(pp)}}
function load(ns,...fsList){const s=new Set();for(const f of fsList){const fp=path.join(LOCALE_DIR,'en',f);if(fs.existsSync(fp))walk(JSON.parse(fs.readFileSync(fp,'utf8')),'',s)}nsKeys[ns]=s}
load('common','common.json');load('auth','auth.json');load('bookmarks','bookmarks.json');load('tags','tags.json')
load('settings','settings/api.json','settings/basic.json','settings/browser.json','settings/core.json','settings/data.json','settings/language.json','settings/public-share.json','settings/sync-health.json','settings/workspace.json')
load('tabGroups','tabGroups/core.json','tabGroups/organization.json','tabGroups/views.json')
const ALL_NS=Object.keys(nsKeys)
const SHARED=new Set(['components/common/ConfirmDialog.tsx','components/common/InputDialog.tsx','components/common/DialogHost.tsx','components/common/Toast.tsx','components/common/PaginationFooter.tsx','components/common/ThemeToggle.tsx','components/common/SearchToolbar.tsx','components/common/ErrorBoundary.tsx','components/common/BatchActionBar.tsx','components/tab-groups/MoveToFolderDialog.tsx','components/layout/ShellHeaderRight.tsx','components/layout/FullScreenAppShell.tsx','components/layout/PublicShareShell.tsx','components/layout/MobileBottomNav.tsx'])
const DYN={'components/bookmarks/workspace/BookmarkWorkspaceLayout.tsx':['bookmarks'],'components/tab-groups/PinnedItemsSection.tsx':['tabGroups'],'components/common/SearchToolbar.tsx':['bookmarks','tabGroups'],'components/tab-groups/EmptyState.tsx':['tabGroups'],'components/tab-groups/tree/TabGroupTree.tsx':['tabGroups'],'components/tab-groups/workspace/TabGroupWorkspaceLayout.tsx':['tabGroups'],'components/tab-groups/grid/TabItemList.tsx':['tabGroups'],'components/tab-groups/grid/TabGroupHeader.tsx':['tabGroups'],'components/tab-groups/grid/TabGroupsGrid.tsx':['tabGroups'],'components/tab-groups/grid/TabItemRow.tsx':['tabGroups'],'components/bookmarks/PinnedBookmarksSection.tsx':['bookmarks'],'components/tab-groups/tree/TabGroupTreeNode.tsx':['tabGroups']}
function rel(p){return path.relative(ROOT,p).split(path.sep).join('/')}
function effNs(r,c){ // PRECISE: union of literal ns + path-derived ns (files mix local t with prop t)
  // SHARED components receive `t` as a prop from callers across every
  // namespace (BatchActionBar is driven by both bookmarks and tabGroups), so
  // their literals must be tested against ALL namespaces — matching only the
  // path-derived ns was the source of ~19 false-positive "dead" keys.
  if(SHARED.has(r)) return ALL_NS
  const lit=[...c.matchAll(/useTranslation\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m=>m[1])
  const path=DYN[r]||(r.startsWith('pages/auth/')?['auth']:r.startsWith('components/tags/')?['tags']:r.startsWith('components/bookmarks/')||r.startsWith('pages/bookmarks/')||r.startsWith('pages/public/')?['bookmarks']:r.startsWith('components/tab-groups/')||r.startsWith('pages/tab-groups/')?['tabGroups']:r.startsWith('pages/settings/')?['settings']:[DEFAULT_NS])
  return [...new Set([...path,...lit])]
}
const live=new Set(); function addLive(ns,k){if(nsKeys[ns]?.has(k))live.add(`${ns}.${k}`)}
function res(nsList,L){if(!L||/\s/.test(L)||L.length>120)return;const ci=L.indexOf(':');if(ci>0&&/^[a-zA-Z]\w*$/.test(L.slice(0,ci))){addLive(L.slice(0,ci),L.slice(ci+1));return}
if(L.includes('${')){const rx='^'+L.replace(/\$\{[^}]*\}/g,'\u0000').replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\u0000/g,'.*')+'$';const re=new RegExp(rx);for(const ns of nsList)for(const k of nsKeys[ns]||[])if(re.test(k))live.add(`${ns}.${k}`);return}
if(/^[a-zA-Z][\w.]*$/.test(L))for(const ns of nsList)addLive(ns,L)}
function ls(d,o){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())ls(p,o);else if(/\.[tj]sx?$|\.json$/.test(e.name))o.push(p)}}
const files=[];ls(ROOT,files);const sf=files.filter(f=>!rel(f).startsWith('i18n/'))
const lr=/(['"`])([^'"`\n]{1,120})\1/g
for(const f of sf){const c=fs.readFileSync(f,'utf8');const ns=effNs(rel(f),c);let m;lr.lastIndex=0;while((m=lr.exec(c)))res(ns,m[2])}
let dt=0;for(const ns of ALL_NS){const d=[...nsKeys[ns]].filter(k=>!live.has(`${ns}.${k}`));if(d.length){console.log(`## ${ns} (${d.length})`);for(const k of d)console.log(`${ns}.${k}`);dt+=d.length}}
console.log(`\n# PRECISE dead (over-mark candidates): ${dt}`)
