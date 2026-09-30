import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { normalizeUrlKey } from '@tmarks/ai/url'
import { refreshBadge } from '../lib/services/bookmark-detect'
import { bookmarksByUrlKey, invalidateBookmarkLookup } from '../lib/services/bookmark-lookup'
import { isCollectableTabUrl } from '../lib/services/tab-collection-rules'
import { db, type LocalBookmark, type LocalFolder } from '../lib/db'
// quick-draft/@tmarks/ai 均为动态加载(见 runAiDraft):首屏不拉 AI 包。
import { loadSaveDefaults } from '../lib/utils/save-defaults'
// 模块级纯助手(标签合并/缩略图 http 过滤/最近目录/页面信息读取)拆至兄弟模块。
import { getLastFolderId, isHttpImageUrl, mergeSelectedTags, readPageInfo, setLastFolderId } from './save-helpers'
// 落库事务(全有或全无 + base 事务内解析)拆至兄弟模块,便于直接测试。
import { persistBookmarkSave } from './save-transaction'
import type { TagItem } from '../components/TagList'
import type { TranslateFn } from '../lib/i18n'
import { useBookmarkSnapshots } from './useBookmarkSnapshots'

type Notify = (level: 'error' | 'success' | 'loading', text: string) => void

const MAX_TAGS_PER_BOOKMARK = 10

export interface BookmarkSaveController {
  loading: boolean; saving: boolean; aiBusy: boolean; aiEnabled: boolean
  tab: chrome.tabs.Tab | null; existing: LocalBookmark | null
  title: string; setTitle: (v: string) => void
  description: string; setDescription: (v: string) => void
  coverImage: string | null; thumbnails: string[]; pageFavicon: string | null
  includeCover: boolean; setIncludeCover: (v: boolean) => void
  isPrivate: boolean; setIsPrivate: (v: boolean) => void
  isTodo: boolean; setIsTodo: (v: boolean) => void
  folderId: string | null; aiFolderPath: string[]
  chooseFolder: (id: string | null) => void
  folders: LocalFolder[]; aiConfidence: number | null
  selectedTags: string[]; toggleTag: (name: string) => void
  recommendedTags: TagItem[]; addCustomTag: (name: string) => void
  showTitleEdit: boolean; setShowTitleEdit: (v: boolean) => void
  showDescEdit: boolean; setShowDescEdit: (v: boolean) => void
  visibleTags: { id: string; name: string; color: string | null; count: number }[]
  handleAiDraft: () => Promise<void>; handleSave: () => Promise<void>
  reload: () => void
  handleThumbnailChange: (index: number) => void
  lastSaveDurationMs: number | null; snapshots: ReturnType<typeof useBookmarkSnapshots>
}

/** 书签保存模式的状态 + 处理逻辑(由 SaveBookmarkView 提取;UI 外壳迁至 BookmarkModeView/Popup)。
 *  选用按名字的 selectedTags(复刻旧版),保存时再解析为 tag id(已有用 id,新标签 ensureTag)。 */
export function useBookmarkSave(notify: Notify, t: TranslateFn): BookmarkSaveController {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [coverImage, setCoverImage] = useState<string | null>(null)
  const [thumbnails, setThumbnails] = useState<string[]>([])
  const [pageFavicon, setPageFavicon] = useState<string | null>(null)
  const [includeCover, setIncludeCover] = useState(false)
  const [isPrivate, setIsPrivate] = useState(false)
  const [isTodo, setIsTodo] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [existing, setExisting] = useState<LocalBookmark | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [recommendedTags, setRecommendedTags] = useState<TagItem[]>([])
  const [aiFolderPath, setAiFolderPath] = useState<string[]>([])
  const [aiConfidence, setAiConfidence] = useState<number | null>(null)
  const [userPickedFolder, setUserPickedFolder] = useState(false)
  // runAiDraft 闭包捕获的 userPickedFolder 是 effect 运行时的陈旧值(用户在
  // AI 分析期间选了目录,闭包里仍是 false),初始草稿必须读 ref 才不会覆盖
  // 用户的选择——与 handleAiDraft 的守卫同语义。
  const userPickedFolderRef = useRef(false)
  // 加载序号:reload(错误重试)重跑加载 effect 时递增,在途的手动 AI 草稿
  // 在落地前比对发现序号变了即丢弃——否则草稿会把状态写回刚刷新过的表单。
  const loadSeqRef = useRef(0)
  const [showTitleEdit, setShowTitleEdit] = useState(false)
  const [showDescEdit, setShowDescEdit] = useState(false)
  const [lastSaveDurationMs, setLastSaveDurationMs] = useState<number | null>(null)
  // loadKey 递增以重触发初始加载 effect(供 BookmarkPane 错误重试)。
  const [loadKey, setLoadKey] = useState(0)
  const tags = useLiveQuery(() => db.tags.toArray(), []) ?? []
  const foldersRaw = useLiveQuery(() => db.folders.toArray(), []) ?? []
  const folders = foldersRaw.filter((f) => !f.deleted_at && f.pending_op !== 'delete')
  const visibleTags = tags.filter((tag) => tag.pending_op !== 'delete').map((tag) => ({ id: tag.id, name: tag.name, color: tag.color, count: tag.bookmark_count })).sort((a, b) => b.count - a.count)
  const snapshots = useBookmarkSnapshots({ bookmark: existing, tabId: tab?.id, notify, t })

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
        const [found, pageInfo, conn] = await Promise.all([
          // 与 saveBookmarkLocal 一致:按 normalized url 去重(仅精确匹配会漏掉
          // 已导入书签的等价 URL,造成重复保存)。走共享扫描缓存:与采集
          // 视图的全表扫描合并为一次(见 lib/services/bookmark-lookup.ts)。
          active?.url
            ? bookmarksByUrlKey().then((map) => map.get(normalizeUrlKey(active.url!)))
            : Promise.resolve(undefined),
          readPageInfo(active?.id),
          // Dynamic import keeps @tmarks/ai out of the popup's first paint;
          // the AI toggle settles a beat later for AI users only. The adapter
          // must be installed BEFORE the probe — the package default falls
          // back to localStorage and would never see the extension-stored key.
          import('@tmarks/ai')
            .then(async (m) => {
              const { initAIStorage } = await import('../lib/ai/ai-storage')
              initAIStorage()
              return m.getActiveAIConnection()
            })
            .catch(() => null),
        ])
        if (cancelled) return
        const existingBm = found && !found.deleted_at ? found : null
        const pageImages = [...new Set([pageInfo?.thumbnail, ...(pageInfo?.thumbnails ?? [])].filter((v): v is string => Boolean(v) && isHttpImageUrl(v)))]
        setTab(active ?? null); setExisting(existingBm); setAiEnabled(Boolean(conn))
        const suggested = existingBm?.title ?? pageInfo?.title ?? active?.title ?? active?.url ?? ''
        setTitle((cur) => (cur.trim() ? cur : suggested))
        setDescription(existingBm?.description ?? pageInfo?.description ?? '')
        setCoverImage(existingBm?.cover_image ?? pageImages[0] ?? null)
        setThumbnails(pageImages); setPageFavicon(pageInfo?.favicon ?? null)
        if (existingBm) {
          setIncludeCover(Boolean(existingBm.cover_image))
          setIsPrivate(Boolean(existingBm.is_private))
          setIsTodo(Boolean(existingBm.is_todo))
          setSelectedTags(existingBm.tags.map((tag) => tag.name))
          if (existingBm.folder_id) { const f = await db.folders.get(existingBm.folder_id); setFolderId(f && !f.deleted_at && f.pending_op !== 'delete' ? existingBm.folder_id : null) }
          else setFolderId(null)
        } else {
          const defaults = await loadSaveDefaults()
          setIncludeCover(defaults.includeCover)
          setIsPrivate(defaults.defaultIsPrivate)
          setIsTodo(false)
          if (defaults.snapshot) snapshots.setEnabled(true)
          const last = await getLastFolderId(); if (last) { const f = await db.folders.get(last); if (f && !f.deleted_at && f.pending_op !== 'delete') setFolderId(last) }
        }
        if (conn && active?.url && !existingBm) void runAiDraft(active.url, suggested, pageInfo?.description, pageInfo?.content)
      } catch (error) {
        console.warn('[tmark] popup page load failed', error)
        notify('error', t('popup.toast.loadFail'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    const runAiDraft = async (url: string, baseTitle: string, desc: string | undefined, content: string | undefined): Promise<void> => {
      setAiBusy(true)
      try {
        const [{ initAIStorage }, { buildQuickBookmarkDraft }] = await Promise.all([
          import('../lib/ai/ai-storage'),
          import('../lib/ai/quick-draft'),
        ])
        initAIStorage()
        const draft = await buildQuickBookmarkDraft({ url, title: baseTitle, description: desc, content })
        if (cancelled) return
        if (!draft.ok) return
        setTitle(draft.title)
        if (draft.description.trim()) setDescription(draft.description)
        const names = [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))]
        const allTags = await db.tags.toArray()
        const known = new Set(allTags.filter((tg) => tg.pending_op !== 'delete').map((tg) => tg.name.toLowerCase()))
        setRecommendedTags(names.map((name) => ({ name, isNew: !known.has(name.toLowerCase()) })))
        setSelectedTags((cur) => mergeSelectedTags(cur, names))
        if (!userPickedFolderRef.current) { setAiFolderPath(draft.folderPath); setAiConfidence(draft.confidence) }
      } catch (error) {
        console.warn('[tmark] AI draft failed', error)
      } finally {
        if (!cancelled) setAiBusy(false)
      }
    }
    void load()
    return () => { cancelled = true; loadSeqRef.current += 1 }
  }, [notify, t, loadKey])

  /** 重试初始加载(加载失败时 MessageLayer onRetry 调用)。 */
  const reload = useCallback((): void => {
    setLoading(true)
    setLoadKey((k) => k + 1)
  }, [])

  const toggleTag = useCallback((name: string): void => {
    setSelectedTags((cur) => cur.some((n) => n.toLowerCase() === name.toLowerCase()) ? cur.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...cur, name])
  }, [])

  /** 用户从下拉手动选文件夹:置 folderId、清空 AI 路径、标记"用户已选",确保后续保存与重新分析都以用户选择为准。 */
  const chooseFolder = useCallback((id: string | null): void => {
    setFolderId(id); setAiFolderPath([]); setUserPickedFolder(true); userPickedFolderRef.current = true
  }, [])

  const addCustomTag = useCallback((name: string): void => {
    const trimmed = name.trim()
    if (!trimmed) return
    setSelectedTags((cur) => (cur.some((n) => n.toLowerCase() === trimmed.toLowerCase()) ? cur : [...cur, trimmed]))
  }, [])

  const handleAiDraft = async (): Promise<void> => {
    if (!tab?.url || aiBusy) return
    // 序号快照:在途草稿若赶上 reload 重载,落地前发现序号变了即丢弃,
    // 避免把旧页面的标题/标签/目录写回刚刷新过的表单。
    const seq = loadSeqRef.current
    setAiBusy(true)
    try {
      const pageInfo = await readPageInfo(tab.id)
      const { initAIStorage } = await import('../lib/ai/ai-storage')
      const { buildQuickBookmarkDraft } = await import('../lib/ai/quick-draft')
      initAIStorage()
      const draft = await buildQuickBookmarkDraft({ url: tab.url, title: title || pageInfo?.title || tab.title || tab.url, description: pageInfo?.description ?? description, content: pageInfo?.content })
      if (loadSeqRef.current !== seq) return
      if (!draft.ok) { notify('error', t('popup.toast.aiUnavailable')); return }
      setTitle(draft.title)
      if (draft.description.trim()) setDescription(draft.description)
      const names = [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))]
      const allTags = await db.tags.toArray()
      const known = new Set(allTags.filter((tg) => tg.pending_op !== 'delete').map((tg) => tg.name.toLowerCase()))
      setRecommendedTags(names.map((name) => ({ name, isNew: !known.has(name.toLowerCase()) })))
      setSelectedTags((cur) => mergeSelectedTags(cur, names))
      if (!userPickedFolder) { setAiFolderPath(draft.folderPath); setAiConfidence(draft.confidence) }
      notify('success', t('popup.toast.aiApplied'))
    } catch (error) {
      console.warn('[tmark] AI draft failed', error)
      notify('error', t('popup.toast.aiUnavailable'))
    } finally {
      setAiBusy(false)
    }
  }

  const handleThumbnailChange = useCallback((index: number): void => {
    const img = thumbnails[index]
    if (img) setCoverImage(img)
  }, [thumbnails])

  const handleSave = async (): Promise<void> => {
    const url = tab?.url
    // 仅 http/https 页面可保存:内部页(chrome://、about:blank 等)会生成无法同步的
    // 无效书签,并可能把内部 URL 送进 AI 草稿。
    if (!url || !isCollectableTabUrl(url) || saving || aiBusy) return
    setSaving(true)
    const start = performance.now()
    try {
      const uniqueSelectedNames = [...new Set(selectedTags.map((name) => name.trim()).filter(Boolean))].slice(0, MAX_TAGS_PER_BOOKMARK)
      const knownByName = new Map(visibleTags.map((tag) => [tag.name.toLowerCase(), tag]))
      // 落库事务拆至 save-transaction.ts(全有或全无 + 事务内 base 解析),
      // 见该模块头注释。
      const bm = await persistBookmarkSave({
        existing, url, title,
        nextDescription: description.trim() || null,
        nextCover: includeCover ? coverImage : null,
        favicon: tab?.favIconUrl || pageFavicon || null,
        userPickedFolder, folderId, aiFolderPath, isPrivate, isTodo,
        uniqueSelectedNames, knownByName,
      })
      setExisting(bm)
      invalidateBookmarkLookup()
      void setLastFolderId(bm.folder_id)
      if (tab.id != null) void refreshBadge(tab.id, url, true).catch(() => undefined)
      notify('success', t('popup.toast.savedSyncing'))
      void chrome.runtime.sendMessage({ type: 'SYNC_NOW' }).catch((error) => console.warn('[tmark] SYNC_NOW request failed', error))
      if (snapshots.enabled) { void snapshots.create(bm).then((ok) => setTimeout(() => notify(ok ? 'success' : 'error', ok ? t('popup.toast.snapshotUploading') : t('popup.toast.snapshotFail')), 1500)); snapshots.setEnabled(false) }
      setLastSaveDurationMs(performance.now() - start)
    } catch (error) {
      console.error('[tmark] save bookmark failed', error)
      notify('error', t('popup.toast.saveFail'))
    } finally {
      setSaving(false)
    }
  }

  return {
    loading, saving, aiBusy, aiEnabled, tab, existing, title, setTitle, description, setDescription,
    coverImage, thumbnails, pageFavicon, includeCover, setIncludeCover, isPrivate, setIsPrivate, isTodo, setIsTodo, folderId, aiFolderPath,
    chooseFolder, folders, aiConfidence,
    selectedTags, toggleTag, recommendedTags, addCustomTag,
    showTitleEdit, setShowTitleEdit, showDescEdit, setShowDescEdit, visibleTags,
    handleAiDraft, handleSave, reload, handleThumbnailChange, lastSaveDurationMs, snapshots,
  }
}
