import { cn } from '../lib/utils/cn'
import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Folder, List, Plus, X } from 'lucide-react'
import type { EntityId } from '@tmarks/contracts'
import { db } from '../lib/db'
import { createTabGroupFolderLocal } from '../lib/db/tab-collections'
import { useI18n } from '../lib/i18n'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../lib/ui/select'
import { useDialogA11y } from '../lib/ui/dialog-a11y'

export interface CollectionOption {
  mode: 'new' | 'existing' | 'folder'
  targetId?: EntityId
  parentId?: EntityId
  title?: string
}

interface Props {
  selectedCount: number
  onConfirm: (option: CollectionOption) => void
  onCancel: () => void
}

const NEW_FOLDER = '__new_folder__'

/** 采集选项弹窗:复刻旧版 CollectionOptionsDialogView 的左图标栏 + 右配置 + 底部按钮布局,
 *  数据接新版 db.tabGroups(useLiveQuery)+createTabGroupFolderLocal。 */
export function CollectionOptionsDialog({ selectedCount, onConfirm, onCancel }: Props) {
  const { t } = useI18n()
  const [mode, setMode] = useState<'new' | 'existing' | 'folder'>('new')
  const [title, setTitle] = useState('')
  const [targetId, setTargetId] = useState('')
  const [parentId, setParentId] = useState(NEW_FOLDER)
  const [folderName, setFolderName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  // ESC 关闭 + 焦点圈 + 关闭时焦回触发按钮;创建文件夹进行中(busy)禁退。
  useDialogA11y(true, cardRef, () => { if (!busy) onCancel() })

  const groups = useLiveQuery(() => db.tabGroups.toArray(), []) ?? []
  const folders = groups.filter((group) => group.is_folder && !group.deleted_at)
  const targets = groups.filter((group) => !group.is_folder && !group.deleted_at)

  useEffect(() => {
    if (mode === 'existing' && (!targetId || !targets.some((group) => group.id === targetId))) setTargetId(targets[0]?.id ?? '')
  }, [mode, targetId, targets])

  const confirm = async (): Promise<void> => {
    if (busy) return
    setError(null)
    if (mode === 'existing') {
      if (!targetId) { setError(t('popup.opt.selectTarget')); return }
      onConfirm({ mode, targetId: targetId as EntityId })
      return
    }
    if (mode === 'folder') {
      let resolvedParent = parentId
      if (resolvedParent === NEW_FOLDER) {
        const name = folderName.trim()
        if (!name) { setError(t('popup.opt.folderNameRequired')); return }
        setBusy(true)
        try {
          const folder = await createTabGroupFolderLocal(name, null)
          resolvedParent = folder.id
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : t('popup.opt.folderCreateFail'))
          return
        } finally {
          setBusy(false)
        }
      }
      onConfirm({ mode, parentId: resolvedParent as EntityId, title: title.trim() || undefined })
      return
    }
    onConfirm({ mode, title: title.trim() || undefined })
  }

  const modeBtn = (active: boolean): string =>
    `w-10 h-10 flex items-center justify-center rounded-lg transition-all ${active ? 'bg-[var(--tab-popup-primary-from)] text-[var(--tab-popup-primary-text)] shadow-md' : 'bg-[var(--tab-surface)] text-[var(--tab-text-muted)] hover:bg-[var(--tab-surface-muted)] hover:text-[var(--tab-text)] border border-[var(--tab-border)]'}`

  return (
    <div className="fixed inset-0 z-[var(--tab-z-dialog)] flex items-center justify-center bg-[var(--tab-overlay)] p-4 backdrop-blur-sm" onClick={() => { if (!busy) onCancel() }} role="presentation">
      <div ref={cardRef} className="flex max-h-[520px] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl bg-[var(--tab-surface)] shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="collection-options-title">
        <div className="border-b border-[var(--tab-border)] bg-[var(--tab-message-info-bg)] px-5 py-4">
          {error && <div className="mb-3 rounded-lg border border-[var(--tab-message-danger-border)] bg-[var(--tab-message-danger-bg)] px-3 py-2 text-xs text-[var(--tab-message-danger-icon)]">{error}</div>}
          <div className="flex items-center justify-between">
            <div>
              <h2 id="collection-options-title" className="text-base font-bold text-[var(--tab-text)]">{t('popup.opt.title')}</h2>
              <p className="mt-0.5 text-xs text-[var(--tab-text-muted)]">{t('popup.selected', { count: selectedCount })}</p>
            </div>
            <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg p-1.5 text-[var(--tab-text-muted)] transition-colors hover:bg-[var(--tab-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50" aria-label={t('btn.close')}><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-14 flex-col items-center space-y-2 overflow-y-auto border-r border-[var(--tab-border)] bg-[var(--tab-surface-muted)] py-3">
            <button type="button" onClick={() => { setMode('new'); setError(null) }} title={t('popup.opt.newGroup')} className={modeBtn(mode === 'new')}><Plus className="h-5 w-5" /></button>
            <button type="button" onClick={() => { setMode('existing'); setError(null) }} disabled={targets.length === 0} title={targets.length === 0 ? t('popup.opt.noGroups') : t('popup.opt.addToExisting')} className={cn(`${modeBtn(mode === 'existing')} ${targets.length === 0 ? 'cursor-not-allowed opacity-50' : ''}`)}><List className="h-5 w-5" /></button>
            <button type="button" onClick={() => { setMode('folder'); setError(null) }} title={t('popup.opt.addToFolder')} className={modeBtn(mode === 'folder')}><Folder className="h-5 w-5" /></button>
          </div>

          <div className="flex-1 overflow-y-auto bg-[var(--tab-surface)] p-5">
            {(mode === 'new' || mode === 'folder') && (
              <div className="mb-3">
                <h3 className="mb-1.5 text-sm font-semibold text-[var(--tab-text)]">{mode === 'folder' ? t('popup.opt.addToFolder') : t('popup.opt.newGroup')}</h3>
                <p className="mb-3 text-xs text-[var(--tab-text-muted)]">{mode === 'folder' ? t('popup.opt.addToFolderDesc') : t('popup.opt.newGroupDesc')}</p>
                <label className="mb-1.5 block text-xs font-medium text-[var(--tab-text)]">{t('popup.opt.groupNameOptional')}</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('popup.opt.groupNamePlaceholder')} disabled={busy} className="w-full rounded-lg border border-[var(--tab-border-strong)] bg-[var(--tab-surface)] px-3 py-2 text-xs text-[var(--tab-text)] placeholder:text-[var(--tab-text-muted)] focus:border-transparent" />
              </div>
            )}
            {mode === 'existing' && (
              targets.length === 0
                ? <div className="flex flex-col items-center justify-center py-6 text-center"><List className="mb-2 h-10 w-10 text-[var(--tab-text-muted)]" /><p className="text-xs text-[var(--tab-text-muted)]">{t('popup.opt.noGroups')}</p><p className="mt-0.5 text-[10px] text-[var(--tab-text-muted)]">{t('popup.opt.noGroupsHint')}</p></div>
                : <div><label className="mb-1.5 block text-xs font-medium text-[var(--tab-text)]">{t('popup.opt.selectTarget')}</label><Select value={targetId || '__none__'} onValueChange={(v) => setTargetId(v === '__none__' ? '' : v)} disabled={busy}><SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__">{t('popup.opt.selectTarget')}</SelectItem>{targets.map((group) => <SelectItem key={group.id} value={group.id}>{group.title}</SelectItem>)}</SelectContent></Select></div>
            )}
            {mode === 'folder' && (
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--tab-text)]">{t('popup.opt.selectFolder')}</label>
                <Select value={parentId} onValueChange={setParentId} disabled={busy}>
                  <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW_FOLDER}>{t('popup.opt.newFolder')}</SelectItem>
                    {folders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.title}</SelectItem>)}
                  </SelectContent>
                </Select>
                {parentId === NEW_FOLDER && <input type="text" value={folderName} maxLength={50} onChange={(e) => setFolderName(e.target.value)} placeholder={t('popup.opt.folderNamePlaceholder')} disabled={busy} className="mt-2 w-full rounded-lg border border-[var(--tab-border-strong)] bg-[var(--tab-surface)] px-3 py-2 text-xs text-[var(--tab-text)] placeholder:text-[var(--tab-text-muted)] focus:border-transparent" />}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-2.5 border-t border-[var(--tab-border)] bg-[var(--tab-surface-muted)] px-5 py-3">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-[var(--tab-border-strong)] bg-[var(--tab-surface)] px-4 py-2 text-xs font-medium text-[var(--tab-text)] transition-colors hover:bg-[var(--tab-surface-muted)] disabled:cursor-not-allowed disabled:opacity-50">{t('btn.cancel')}</button>
          <button type="button" onClick={() => void confirm()} disabled={busy || (mode === 'existing' && targets.length === 0)} className="rounded-lg bg-[var(--tab-popup-primary-from)] px-4 py-2 text-xs font-medium text-[var(--tab-popup-primary-text)] shadow-md transition-all hover:opacity-90 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50">{busy ? t('btn.creating') : t('popup.opt.confirm')}</button>
        </div>
      </div>
    </div>
  )
}
