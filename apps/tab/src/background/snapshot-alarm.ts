import { pushSnapshots } from '../lib/services/snapshot-upload'

/**
 * 定期(5 min)排空 snapshotUploads 中到期的 pending/failed 退避项,上传 R2。
 * 与 popup 即时触发互补:popup 关闭后或即时触发失败时,由 alarm 兜底重试。
 */
const ALARM_NAME = 'tmark-snapshot-upload-drain'
const INTERVAL_MIN = 5

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return
  void pushSnapshots().catch((e: unknown) => console.warn('[TMark] snapshot upload drain alarm failed:', e))
})

export function registerSnapshotDrainAlarm(): void {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: INTERVAL_MIN })
}
