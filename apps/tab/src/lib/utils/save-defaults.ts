/** 书签保存默认值(含封面/快照)的持久化。存 chrome.storage.local[tmark:defaults]。
 *  由 options 偏好段写入、popup 保存流程读取以初始化开关默认状态。 */

const SAVE_DEFAULTS_KEY = 'tmark:defaults'

export interface SaveDefaults {
  includeCover: boolean
  snapshot: boolean
  defaultIsPrivate: boolean
}

export const DEFAULT_SAVE_DEFAULTS: SaveDefaults = { includeCover: false, snapshot: false, defaultIsPrivate: false }

export async function loadSaveDefaults(): Promise<SaveDefaults> {
  try {
    const res = await chrome.storage.local.get(SAVE_DEFAULTS_KEY)
    const d = (res[SAVE_DEFAULTS_KEY] as Partial<SaveDefaults> | undefined) ?? {}
    return { includeCover: d.includeCover ?? false, snapshot: d.snapshot ?? false, defaultIsPrivate: d.defaultIsPrivate ?? false }
  } catch {
    return { ...DEFAULT_SAVE_DEFAULTS }
  }
}

export async function saveSaveDefaults(d: SaveDefaults): Promise<void> {
  try {
    await chrome.storage.local.set({ [SAVE_DEFAULTS_KEY]: d })
  } catch {
    /* ignore */
  }
}
