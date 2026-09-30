/**
 * TMark background service worker (MV3)。
 * 协调标签页采集、revision 同步;右键菜单 + 消息总线入口。
 */
import { collectCurrentWindowTabs } from '../lib/services/tab-collection'
import { refreshBadge } from '../lib/services/bookmark-detect'
import { getCredentials, isAuthenticated } from '../lib/api/auth'
import { getApiOrigin } from '../lib/api/config'
import { db } from '../lib/db'
import { resetStrandedSyncingRows } from '../lib/db/queue-repair'
import { runSync, fullResync, type SyncResult } from '../lib/sync'
import { retrySyncQueueItem, forceLocalSyncQueueItem, acceptRemoteSyncQueueItem } from '../lib/sync/push'
import { handleGetSyncStatus } from '../lib/sync/sync-status'
import { notifyCollectResult, notifySyncResult } from '../lib/notifications'
import { tt, currentLocale } from '../lib/i18n'
import { ensureEnDict } from '../lib/i18n-dict'
import { registerSyncAlarm } from './sync-alarm'
import { registerSyncQueueAlarm } from './queue-alarm'
import { registerSnapshotDrainAlarm } from './snapshot-alarm'
import { extractPageInfoBg, capturePageBg } from './page-info-bg'
import { injectWebBridgeIntoExistingTabs, injectWebBridgeIntoTab } from './bridge-inject'

const MENU_ID = 'tmark-collect-window'

// OPEN_TABS 上限:桥接仅在可信源挂载,但可信页面上的任意脚本都可触发;
// 限制条数与单条长度,防止恶意页面借扩展刷开标签页。
const OPEN_TABS_MAX_COUNT = 50
const OPEN_TABS_MAX_URL_LENGTH = 2000

// Write-behind push: any syncQueue mutation schedules a debounced runSync so
// that other devices see the change within seconds instead of waiting for the
// periodic 5-minute alarm. runSync is already mutex-guarded, so the debounce
// timer only collapses bursts — it never risks double-execution racing.
let writeBehindTimer: ReturnType<typeof setTimeout> | null = null
const WRITE_BEHIND_DEBOUNCE_MS = 1500

function scheduleWriteBehindPush(): void {
  if (writeBehindTimer !== null) clearTimeout(writeBehindTimer)
  writeBehindTimer = setTimeout(() => {
    writeBehindTimer = null
    void runSync().catch((e) => console.warn('[TMark] write-behind sync failed:', e))
  }, WRITE_BEHIND_DEBOUNCE_MS)
}

// Hook the sync queue so any local write schedules a sub-2s push to cloud,
// replacing the previous "wait for the 5-minute alarm" multi-device staleness.
db.syncQueue.hook('creating', scheduleWriteBehindPush)
db.syncQueue.hook('updating', scheduleWriteBehindPush)

// Cold-start repair: a killed service worker leaves rows stuck in 'syncing' /
// 'uploading' (both are marked before network I/O and no drainer selects them).
// Reset on every cold start so the next drain retries them (pushDirty now also
// self-heals at entry/exit via the same helper). Re-pushed sync ops are safe
// via server-side idempotency; re-uploading a snapshot after a crash is
// preferable to silently losing it.
void resetStrandedSyncingRows()
// Snapshot rows age-guarded: uploads also run in the popup context, and any
// tab event can cold-start this worker mid-upload — resetting fresh rows
// would hand the very row the popup is POSTing to the next drain (duplicate
// snapshot in R2). 10 min far exceeds any single upload; older rows are
// genuinely abandoned and retry. runSync/pushDirty never run outside the SW,
// so the syncQueue reset needs no such guard.
const SNAPSHOT_STALE_UPLOAD_MS = 10 * 60 * 1000
void db.snapshotUploads
  .where('status')
  .equals('uploading')
  .filter((r) => r.updated_at <= new Date(Date.now() - SNAPSHOT_STALE_UPLOAD_MS).toISOString())
  .modify({ status: 'pending', updated_at: new Date().toISOString() })

chrome.runtime.onInstalled.addListener((details) => {
  console.info('[TMark] installed:', details.reason)
  void createContextMenus()
  registerSyncAlarm()
  registerSyncQueueAlarm()
  registerSnapshotDrainAlarm()
  // 安装后立即尝试同步(未登录则 runSync 自动落 local_only 模式)。
  void runSync().catch((e) => console.error('[TMark] initial sync failed:', e))
})

/** (重)安装时重建右键菜单,避免遗留失效项。 */
async function createContextMenus(): Promise<void> {
  // 英文菜单标题需要 en 字典装载完成(zh 静态在主包,零等待)。
  if (currentLocale() === 'en') await ensureEnDict()
  chrome.contextMenus.removeAll(() => {
    // 带 callback 消费 runtime.lastError:菜单重建竞态(如浏览器启动早期)不产生未处理错误。
    chrome.contextMenus.create({
      id: MENU_ID,
      title: tt('menu.collectWindow'),
      contexts: ['page'],
    }, () => void chrome.runtime.lastError)
  })
}

// 语言切换后重建菜单:菜单标题在安装时按当时 locale 冻结,不重建会一直显示旧语言。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'tmark:locale' in changes) void createContextMenus()
})

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return
  const result = await collectCurrentWindowTabs()
  notifyCollectResult(result)
})

/** popup/options 通过消息触发采集或同步;统一异步响应。 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false
  // Own extension pages go straight through. They must be checked BEFORE
  // sender.tab: an options/popup page opened as a tab (F12 "open in new tab",
  // or automated runs) carries a non-null sender.tab just like a content
  // script, and treating it as a page relay silently dropped every SYNC_NOW /
  // GET_SYNC_STATUS message from that shape (live-tested).
  const isOwnPage =
    typeof sender.url === 'string' &&
    sender.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)
  if (isOwnPage) return handleRuntimeMessage(msg, sendResponse)
  // Content scripts (sender.tab set) may only relay the two web-bridge messages,
  // which web-bridge.ts installs exclusively on trusted origins. All other
  // messages remain extension-UI-only (popup/options), so a page can never
  // trigger sync operations even if externally_connectable is widened later.
  const isBridgeRelay = msg?.type === 'OPEN_TABS' || msg?.type === 'GET_SYNC_STATUS'
  if (sender.tab && !isBridgeRelay) return false
  if (sender.tab) {
    // 桥接类型本身不是信任凭据:消息类型门禁只拦类型不拦来源,任何页面的
    // content script 都能发这两类消息。校验 sender 来源必须是配置的 API 源
    // (web-bridge 的唯一挂载点)后才分发。
    void (async () => {
      if (await isTrustedBridgeOrigin(sender)) {
        handleRuntimeMessage(msg, sendResponse)
      } else {
        sendResponse({ error: 'bridge origin not allowed' })
      }
    })()
    return true
  }
  return handleRuntimeMessage(msg, sendResponse)
})

/** 桥接消息仅信任配置的 API 源(web 应用所在 origin)。 */
async function isTrustedBridgeOrigin(sender: chrome.runtime.MessageSender): Promise<boolean> {
  try {
    const apiOrigin = await getApiOrigin()
    const origin = sender.origin ?? (sender.url ? new URL(sender.url).origin : null)
    return Boolean(origin) && origin === apiOrigin
  } catch {
    return false
  }
}

/** 消息总线负载:字段按类型取用,缺省即忽略(与原 onMessage 隐式 any 等价的受控形态)。 */
interface RuntimeMessage {
  type?: string
  id?: string
  urls?: unknown
  windowMode?: 'new' | 'current' | 'incognito'
  tabId?: number
  html?: string
}

/** 三个队列复核动作共用的 id 提取:缺失时直接回错,而不是把 undefined 传进 Dexie。 */
function queueItemId(msg: RuntimeMessage | undefined): string | null {
  return typeof msg?.id === 'string' && msg.id ? msg.id : null
}

function handleRuntimeMessage(msg: RuntimeMessage | undefined, sendResponse: (response?: unknown) => void): boolean {
  if (msg?.type === 'SYNC_NOW') {
    void runSync()
      .then((r: SyncResult) => {
        notifySyncResult(r)
        sendResponse(r)
      })
      .catch((e) => sendResponse({ error: e instanceof Error ? e.message : 'sync failed' }))
    return true
  }
  if (msg?.type === 'RESYNC') {
    void fullResync()
      .then((r: SyncResult) => {
        notifySyncResult(r)
        sendResponse(r)
      })
      .catch((e) => sendResponse({ error: e instanceof Error ? e.message : 'resync failed' }))
    return true
  }
  if (msg?.type === 'RETRY_SYNC_ITEM') {
    const id = queueItemId(msg)
    if (!id) { sendResponse({ error: 'missing id' }); return true }
    void retrySyncQueueItem(id).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ error: e instanceof Error ? e.message : 'retry failed' }))
    return true
  }
  if (msg?.type === 'FORCE_LOCAL_SYNC_ITEM') {
    const id = queueItemId(msg)
    if (!id) { sendResponse({ error: 'missing id' }); return true }
    void forceLocalSyncQueueItem(id).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ error: e instanceof Error ? e.message : 'force local failed' }))
    return true
  }
  if (msg?.type === 'ACCEPT_REMOTE_SYNC_ITEM') {
    const id = queueItemId(msg)
    if (!id) { sendResponse({ error: 'missing id' }); return true }
    void acceptRemoteSyncQueueItem(id).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ error: e instanceof Error ? e.message : 'accept remote failed' }))
    return true
  }
  if (msg?.type === 'OPEN_TABS') {
    void (async () => {
      try {
        const urls: string[] = Array.isArray(msg.urls) ? (msg.urls as string[]) : []
        const mode: 'new' | 'current' | 'incognito' = msg.windowMode ?? 'new'
        await openTabs(urls, mode)
        sendResponse({ ok: true })
      } catch (e) {
        sendResponse({ error: e instanceof Error ? e.message : 'open tabs failed' })
      }
    })()
    return true
  }
  if (msg?.type === 'GET_SYNC_STATUS') {
    void handleGetSyncStatus(db)
      .then((result) => sendResponse(result))
      .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : 'get sync status failed' }))
    return true
  }
  // 页面信息提取兜底:popup 请求 background 取页面 pageInfo/快照,background 优先走
  // content script,无接收方时回退 executeScript 注入(修复扩展安装前已开页面无采集)。
  if (msg?.type === 'EXTRACT_PAGE_INFO_BG') {
    void extractPageInfoBg(msg.tabId as number).then((r) => sendResponse(r)).catch(() => sendResponse(null))
    return true
  }
  if (msg?.type === 'CAPTURE_PAGE_BG') {
    void capturePageBg(msg.tabId as number).then((r) => sendResponse(r)).catch(() => sendResponse(null))
    return true
  }
  // R5-P3 blob URL lifetime: the popup's document is destroyed the moment
  // the new tab takes focus, and a blob created by that document dies with
  // it — the snapshot tab raced popup teardown. Creating the blob in the
  // SW (a separate execution context with its own lifetime) fixes the race.
  if (msg?.type === 'OPEN_SNAPSHOT_VIEWER') {
    const html = typeof msg.html === 'string' ? msg.html : ''
    if (!html) { sendResponse({ error: 'missing html' }); return true }
    void (async () => {
      const objectUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      await chrome.tabs.create({ url: objectUrl, active: true })
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
      sendResponse({ ok: true })
    })().catch((e) => sendResponse({ error: e instanceof Error ? e.message : 'open snapshot failed' }))
    return true
  }
  return false
}

/** 当前页是否已保存:badge 绿✓ 提示(浏览时被动识别)。页面 complete + 切 tab 时刷新。 */
async function isAuthed(): Promise<boolean> {
  return isAuthenticated(await getCredentials())
}

/** 打开一组 URL(网页 OPEN_TABS 中继 + popup 恢复复用)。mode:new/current/incognito。 */
async function openTabs(urls: string[], mode: 'new' | 'current' | 'incognito'): Promise<void> {
  const normalized = urls
    .filter((u) => typeof u === 'string' && u.length <= OPEN_TABS_MAX_URL_LENGTH && /^https?:\/\//i.test(u))
    .slice(0, OPEN_TABS_MAX_COUNT)
  if (normalized.length === 0) return
  if (mode === 'current') {
    for (const u of normalized) await chrome.tabs.create({ url: u, active: false })
    return
  }
  await chrome.windows.create({ url: normalized, focused: true, incognito: mode === 'incognito' })
}
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !tab.url) return
  // .catch 兜底:标签页在 await 期间关闭会让 badge API reject——
  // unhandled rejection 只剩控制台噪声,静默即可。
  void refreshBadge(tabId, tab.url, await isAuthed()).catch(() => undefined)
  // Web bridge 按需注入:仅 API 源标签页(替代原全量静态 content_scripts)。
  void injectWebBridgeIntoTab(tabId, tab.url)
})
chrome.tabs.onActivated.addListener(async (info) => {
  try {
    const tab = await chrome.tabs.get(info.tabId)
    void refreshBadge(info.tabId, tab.url, await isAuthed()).catch(() => undefined)
  } catch {
    /* tab 已关闭,忽略 */
  }
})

// SW 冷启动:对扩展未在場期间打开的 API 源标签页补注入桥函数。
void injectWebBridgeIntoExistingTabs()

export {}
