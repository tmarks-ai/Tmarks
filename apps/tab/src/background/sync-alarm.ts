import { runSync } from '../lib/sync'

const ALARM_NAME = 'tmark-sync'
const INTERVAL_MIN = 30

/** 注册周期同步 alarm(每 30 分钟一次)。onInstalled 时调用。 */
export function registerSyncAlarm(): void {
  void chrome.alarms.create(ALARM_NAME, { periodInMinutes: INTERVAL_MIN })
}

// 顶层注册:SW 每次唤醒重新绑定监听(上一实例已随 SW 销毁,无重复)。
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return
  void runSync().catch((e) => console.error('[TMark] sync alarm failed:', e))
})
