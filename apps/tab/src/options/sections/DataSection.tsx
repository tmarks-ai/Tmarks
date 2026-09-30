import { useEffect, useRef, useState } from 'react'
import { Database, Download, Upload } from 'lucide-react'
import { collectLocalExport, downloadJsonFile, getLocalExportSummary, type ExportScope } from '../../lib/data-export/local-export'
import { parseExportFile, restoreLocalExport, type RestoreResult } from '../../lib/data-export/local-restore'
import { parseImportFile } from '../../lib/import/parsers'
import { executeImport, type ImportExecuteResult } from '../../lib/import/executor'
import type { ImportParseResult, DuplicatePolicy } from '../../lib/import/types'
import { useI18n } from '../../lib/i18n'
import { Button } from '../../lib/ui/button'
import { BlockHeader, SubHeader } from '../../lib/ui/section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../lib/ui/select'
import { Field } from '../../lib/ui/field'
import { Switch } from '../../lib/ui/switch'
import { Flash, useFlash } from '../../lib/ui/flash'

/** 数据区:本地 JSON 导出(scope + includeDeleted)+ 从 JSON 恢复(逐实体计数)。 */
export function DataSection(): React.ReactElement | null {
  const { t } = useI18n()
  const [scope, setScope] = useState<ExportScope>('all')
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [summary, setSummary] = useState({ bookmarks: 0, folders: 0, tags: 0, tabGroups: 0, tabGroupItems: 0 })
  const { msg, flash } = useFlash(4000)
  const [restoring, setRestoring] = useState(false)
  const [importDraft, setImportDraft] = useState<ImportParseResult | null>(null)
  const [importPolicy, setImportPolicy] = useState<DuplicatePolicy>('skip')
  const [importing, setImporting] = useState(false)
  const [restoreDraft, setRestoreDraft] = useState<{ bookmarks: number; tabGroups: number; tags: number; data: Parameters<typeof restoreLocalExport>[0] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  const reload = async () => setSummary(await getLocalExportSummary())
  useEffect(() => { void reload() }, [])

  // 导入/恢复直写本地库,而 write-behind 推送钩子只挂在 background 上下文,
  // options 自己的 Dexie 写不会触发它——不主动 SYNC_NOW 就要等 5 分钟队列
  // alarm,期间其他设备看不到这批数据。与 popup 保存后的行为保持一致。
  const requestSyncPush = () => {
    void chrome.runtime.sendMessage({ type: 'SYNC_NOW' }).catch((e) => console.warn('[tmark] SYNC_NOW request failed', e))
  }

  const handleExport = async () => {
    try {
      const data = await collectLocalExport({ scope, includeDeleted })
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      downloadJsonFile(data, `tmark-export-${ts}.json`)
      flash('ok', t('data.exported'))
    } catch (e) {
      flash('err', e instanceof Error ? e.message : t('data.exportFail'))
    }
  }

  // 导入/恢复文件上限:file.text() 把整个文件读进内存,无上限时一个超大文件
  // 直接把 options 页面撑爆(自伤型 DoS)。50MB 已远超任何真实书签导出。
  const MAX_IMPORT_FILE_BYTES = 50 * 1024 * 1024

  const handleImportFile = async (file: File) => {
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        throw new Error(t('data.importTooLarge'))
      }
      const parsed = parseImportFile(await file.text(), file.name)
      setImportDraft(parsed)
      flash('ok', t('data.importReady', { count: parsed.items.length }))
    } catch (e) {
      flash('err', e instanceof Error ? e.message : t('data.importParseFail'))
    } finally {
      // Reset so re-selecting the same file fires onChange again.
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }

  const handleImport = async () => {
    if (!importDraft || importing) return
    setImporting(true)
    try {
      const result: ImportExecuteResult = await executeImport(importDraft.items, { duplicatePolicy: importPolicy })
      flash('ok', t('data.importOk', { imported: result.imported, skipped: result.skipped, failed: result.failed }))
      setImportDraft(null)
      await reload()
      requestSyncPush()
    } catch (e) {
      flash('err', e instanceof Error ? e.message : t('data.importFail'))
    } finally {
      setImporting(false)
      if (importFileRef.current) importFileRef.current.value = ''
    }
  }
  // 恢复入口与导入入口同型:同样 file.text() 整读进内存,同样需要 50MB 上限
  // (审计 N-4:此路径曾无防护)。
  const handleFile = async (file: File) => {
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        throw new Error(t('data.importTooLarge'))
      }
      const text = await file.text()
      const data = parseExportFile(text)
      if (!data) { flash('err', t('data.invalidFile')); return }
      setRestoreDraft({
        bookmarks: data.bookmarks?.length ?? 0,
        tabGroups: data.tabGroups?.length ?? 0,
        tags: data.tags?.length ?? 0,
        data,
      })
    } catch (e) {
      flash('err', e instanceof Error ? e.message : t('data.restoreFail'))
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleRestoreConfirm = async () => {
    if (!restoreDraft || restoring) return
    setRestoring(true)
    try {
      const r: RestoreResult = await restoreLocalExport(restoreDraft.data)
      flash('ok', t('data.restored', { bookmarks: r.bookmarks, tabGroups: r.tabGroups }))
      setRestoreDraft(null)
      await reload()
      requestSyncPush()
    } catch (e) {
      flash('err', e instanceof Error ? e.message : t('data.restoreFail'))
    } finally {
      setRestoring(false)
    }
  }

  const handleRestoreCancel = () => {
    setRestoreDraft(null)
    if (fileRef.current) fileRef.current.value = ''
  }


  return (
    <div>
      <BlockHeader icon={Database} title={t('data.title')} description={t('data.description')} />
      <Flash msg={msg} className="mt-3" />

      <div className="mt-4 grid gap-2 rounded-xl border border-[var(--tab-options-card-border)] p-3 sm:grid-cols-5">
        <Stat label={t('data.sBookmarks')} value={summary.bookmarks} />
        <Stat label={t('data.sFolders')} value={summary.folders} />
        <Stat label={t('data.sTags')} value={summary.tags} />
        <Stat label={t('data.sTabGroups')} value={summary.tabGroups} />
        <Stat label={t('data.sTabItems')} value={summary.tabGroupItems} />
      </div>

      <div className="mt-4">
        <SubHeader title={t('data.exportTitle')} />
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field inline label={t('data.scope')}>
            <Select value={scope} onValueChange={(v) => setScope(v as ExportScope)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('data.scopeAll')}</SelectItem>
                <SelectItem value="bookmarks">{t('data.scopeBookmarks')}</SelectItem>
                <SelectItem value="tab_groups">{t('data.scopeTabGroups')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Switch on={includeDeleted} onClick={() => setIncludeDeleted(!includeDeleted)} text={t('data.includeDeleted')} />
          <Button variant="primary" size="sm" onClick={() => void handleExport()} leading={<Download className="h-3.5 w-3.5" />}>{t('data.export')}</Button>
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--tab-options-card-border)] pt-4">
        <SubHeader title={t('data.importTitle')} />
        <p className="mt-1 text-xs text-muted-foreground">{t('data.importDesc')}</p>
        <input ref={importFileRef} type="file" accept=".html,.htm,.json,.txt,.csv" disabled={importing} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImportFile(f) }} className="mt-2 hidden" />
        <Button variant="outline" size="sm" className="mt-2" onClick={() => importFileRef.current?.click()} disabled={importing} leading={<Upload className="h-3.5 w-3.5" />}>{t('data.chooseImportFile')}</Button>
        {importDraft && (
          <div className="mt-3 grid gap-2 rounded-xl border border-[var(--tab-options-card-border)] p-3">
            <p className="text-xs">{t('data.importValidCount', { valid: importDraft.items.length, invalid: importDraft.errors.length })}</p>
            <ul className="max-h-28 overflow-auto text-xs text-muted-foreground">
              {importDraft.items.slice(0, 8).map((item) => <li key={`${item.sourceIndex}-${item.url}`} className="truncate">{item.title} · {item.url}</li>)}
            </ul>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Field inline label={t('data.duplicates')}>
                <Select value={importPolicy} onValueChange={(v) => setImportPolicy(v as DuplicatePolicy)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="skip">{t('data.dupPolicySkip')}</SelectItem>
                    <SelectItem value="merge">{t('data.dupPolicyMerge')}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Button variant="primary" size="sm" loading={importing} onClick={() => void handleImport()} disabled={importDraft.items.length === 0}>{importing ? t('data.importing') : t('data.import')}</Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-[var(--tab-options-card-border)] pt-4">
        <SubHeader title={t('data.restoreTitle')} />
        <p className="mt-1 text-xs text-muted-foreground">{t('data.restoreDesc')}</p>
        <input ref={fileRef} type="file" accept="application/json,.json" disabled={restoring} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f) }} className="mt-2 hidden" />
        <Button variant="outline" size="sm" className="mt-2" onClick={() => fileRef.current?.click()} disabled={restoring} leading={<Upload className="h-3.5 w-3.5" />}>{restoring ? t('data.restoring') : t('data.chooseFile')}</Button>
        {restoreDraft && (
          <div className="mt-3 rounded-xl border border-[var(--tab-options-card-border)] p-3">
            <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{t('data.restoreSummary', { bookmarks: restoreDraft.bookmarks, tabGroups: restoreDraft.tabGroups, tags: restoreDraft.tags })}</pre>
            <div className="mt-3 flex gap-2">
              <Button variant="primary" size="sm" loading={restoring} onClick={() => void handleRestoreConfirm()}>{restoring ? t('data.restoring') : t('data.restoreConfirm')}</Button>
              <Button variant="outline" size="sm" onClick={handleRestoreCancel} disabled={restoring}>{t('data.restoreCancel')}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="rounded-xl border border-[var(--tab-options-card-border)] bg-muted/30 p-2 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}
