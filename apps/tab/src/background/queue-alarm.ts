import { pushDirty } from '../lib/sync/push'
import { getSyncState } from '../lib/db/sync-state'

/**
 * 定期(5 min)排空 syncQueue 中到期的 pending/failed 退避项。
 * 与 sync-alarm(30 min 全量 runSync push+pull)互补:让短退避项在两次全量同步之间被重试 push。
 */
const ALARM_NAME = 'tmark-sync-queue-drain'
const INTERVAL_MIN = 5

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return
  void (async () => {
    // 暂停/降级(local_only)期间不排空:runSync 尊重 paused,这里必须同样尊重,
    // 否则"暂停同步"期间脏项仍每 5 分钟上传;local_only(未登录/密钥失效)下
    // 排空只会白打 401。恢复同步(任何 runSync 成功)会把 mode 写回 cloud_sync。
    try {
      const state = await getSyncState()
      if (state.mode !== 'cloud_sync') return
    } catch {
      // 状态读不出来时保守放行:排空失败本身无害(错误不烧重试预算)。
    }
    await pushDirty()
  })().catch((e: unknown) => console.warn('[TMark] sync queue drain alarm failed:', e))
})

export function registerSyncQueueAlarm(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: INTERVAL_MIN })
}
