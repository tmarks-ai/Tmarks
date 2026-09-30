import type { SyncResult } from './sync'
import type { CollectResult } from './services/tab-collection'
import { tt } from './i18n'

// 通知图标:复用打包的 48px 品牌图标(与 manifest icons 同源,换图标自动跟随,免内联 base64)。
const ICON_URL = chrome.runtime.getURL('icons/icon-48.png')

let seq = 0

/** 系统通知(popup 关闭后仍可见的持久反馈)。失败静默降级(不阻塞主流程)。 */
function notify(title: string, message: string): void {
  try {
    void chrome.notifications.create(`tmark-${Date.now()}-${seq++}`, {
      type: 'basic',
      iconUrl: ICON_URL,
      title,
      message,
    })
  } catch (e) {
    console.warn('[TMark] notify failed:', e)
  }
}

/** 同步结果通知(仅受限或有冲突时提醒,避免噪音)。 */
export function notifySyncResult(r: SyncResult): void {
  if (r.conflicts > 0) {
    notify(tt('notify.syncDoneTitle'), tt('notify.syncConflictMsg', { count: r.conflicts }))
  }
}

/** 采集结果通知(右键采集等无 popup 场景的持久反馈;失败复用 collectFail 文案)。 */
export function notifyCollectResult(r: CollectResult): void {
  if (r.success) {
    notify(tt('notify.collectTitle'), tt('notify.collectOk', { count: r.count ?? 0 }))
  } else {
    notify(tt('notify.collectTitle'), tt('popup.toast.collectFail'))
  }
}
