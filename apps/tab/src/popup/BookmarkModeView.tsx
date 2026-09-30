import { cn } from '../lib/utils/cn'
import { Camera, CheckSquare, Eye, FileText, ImageIcon, Lock, LockOpen, Pencil, RefreshCw, Square, Tag as TagIcon } from 'lucide-react'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { PageInfoCard } from '../components/PageInfoCard'
import { SaveTargetBar } from '../components/SaveTargetBar'
import { TagList } from '../components/TagList'
import { getExistingTagClass, getSelectedTagClass, type TagTheme } from '../lib/utils/tagStyles'
import { useI18n } from '../lib/i18n'
import type { BookmarkSaveController } from './useBookmarkSave'

interface Props {
  save: BookmarkSaveController
  tagTheme: TagTheme
}

/** 书签保存模式主区:复刻旧版 BookmarkModeView 的渐变 section 卡布局。
 *  AI 分析中 / AI 未启用 / 已选标签 / 页面信息+4 操作 toggle / AI 推荐 / 标签库 / 保存耗时。 */
export function BookmarkModeView({ save, tagTheme }: Props) {
  const { t } = useI18n()
  const { tab, aiBusy, aiEnabled, recommendedTags, selectedTags, visibleTags, includeCover, setIncludeCover, isPrivate, setIsPrivate, isTodo, setIsTodo, showTitleEdit, setShowTitleEdit, showDescEdit, setShowDescEdit, title, setTitle, description, setDescription, coverImage, thumbnails, pageFavicon, toggleTag, snapshots } = save

  return (
    <>
      {aiBusy && (
        <section className="flex items-center gap-3 rounded-xl border border-[var(--tab-popup-border)] bg-[var(--tab-popup-section-gray-bg)] p-3.5 text-sm text-[var(--tab-popup-text)] shadow-lg">
          <LoadingSpinner /><p>{t('popup.aiAnalyzing')}</p>
        </section>
      )}

      {!aiBusy && !aiEnabled && recommendedTags.length === 0 && (
        <section className="rounded-xl border border-[var(--tab-popup-section-amber-border)] bg-gradient-to-br from-[var(--tab-popup-section-amber-from)] to-[var(--tab-popup-section-amber-to)] p-3.5 shadow-lg">
          <div className="flex items-start gap-3">
            <p className="text-sm font-medium text-[var(--tab-popup-section-amber-title)]">{t('popup.aiDisabledTitle')}</p>
            <p className="mt-1 text-xs text-[var(--tab-popup-section-amber-text)]">{t('popup.aiDisabledDesc')}</p>
          </div>
        </section>
      )}

      {selectedTags.length > 0 && (
        <section className="rounded-xl border border-[var(--tab-popup-section-blue-border)] bg-gradient-to-br from-[var(--tab-popup-section-blue-from)] to-[var(--tab-popup-section-blue-to)] p-3.5 shadow-lg">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-[var(--tab-popup-text)]">{t('popup.selectedTags')}</p>
              <span className="text-[10px] text-[var(--tab-popup-text-muted)]">{t('popup.clickToRemove')}</span>
            </div>
            <span className="rounded-full bg-[var(--tab-popup-section-blue-badge-bg)] px-2 py-0.5 text-xs font-medium text-[var(--tab-popup-section-blue-badge-text)]">{selectedTags.length}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedTags.map((name) => (
              <button key={name} type="button" onClick={() => toggleTag(name)} title={t('popup.clickToRemove')} aria-label={t('popup.clickToRemove')} className={getSelectedTagClass(tagTheme)}><span className="max-w-[120px] truncate">{name}</span></button>
            ))}
          </div>
        </section>
      )}

      {tab?.url && (
        <section className="rounded-xl border border-[var(--tab-popup-section-gray-border)] bg-[var(--tab-popup-section-gray-bg)] p-3.5 shadow-lg">
          <div className="mb-3 flex items-center justify-center gap-2">
            <button type="button" onClick={() => setIncludeCover(!includeCover)} disabled={!coverImage} title={includeCover ? t('tooltip.includeThumbnail') : t('tooltip.noThumbnail')} aria-label={includeCover ? t('tooltip.includeThumbnail') : t('tooltip.noThumbnail')} className={cn(`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ${includeCover ? 'bg-[var(--tab-popup-action-amber-bg)] text-[var(--tab-popup-action-amber-text)]' : 'bg-[var(--tab-popup-action-neutral-bg)] text-[var(--tab-popup-action-neutral-text)]'} ${!coverImage ? 'cursor-not-allowed opacity-40' : ''}`)}><ImageIcon className="h-5 w-5" /></button>
            <button type="button" onClick={() => snapshots.setEnabled(!snapshots.enabled)} title={snapshots.enabled ? t('tooltip.createSnapshot') : t('tooltip.noSnapshot')} aria-label={snapshots.enabled ? t('tooltip.createSnapshot') : t('tooltip.noSnapshot')} className={cn(`relative flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ${snapshots.enabled ? 'bg-[var(--tab-popup-action-purple-bg)] text-[var(--tab-popup-action-purple-text)]' : 'bg-[var(--tab-popup-action-neutral-bg)] text-[var(--tab-popup-action-neutral-text)]'}`)}><Camera className="h-5 w-5" />{snapshots.count > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--tab-popup-primary-from)] px-1 text-[9px] font-semibold text-[var(--tab-popup-primary-text)]">{snapshots.count}</span>}</button>
            <button type="button" onClick={() => void snapshots.openLatest()} disabled={!snapshots.viewable || snapshots.opening} title={snapshots.viewable ? t('tooltip.viewSnapshot') : t('tooltip.viewSnapshotDisabled')} aria-label={snapshots.viewable ? t('tooltip.viewSnapshot') : t('tooltip.viewSnapshotDisabled')} className={cn(`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ${snapshots.viewable ? 'bg-[var(--tab-popup-action-neutral-bg)] text-[var(--tab-popup-action-neutral-text)] hover:bg-[var(--tab-popup-action-purple-bg)] hover:text-[var(--tab-popup-action-purple-text)]' : 'bg-[var(--tab-popup-action-neutral-bg)] text-[var(--tab-popup-action-neutral-text)] opacity-40'}`)}><Eye className="h-5 w-5" /></button>
            <button type="button" onClick={() => setShowTitleEdit(!showTitleEdit)} disabled={aiBusy} title={showTitleEdit ? t('tooltip.editTitleCollapse') : t('tooltip.editTitleExpand')} aria-label={showTitleEdit ? t('tooltip.editTitleCollapse') : t('tooltip.editTitleExpand')} className={cn(`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ${showTitleEdit ? 'bg-[var(--tab-popup-action-blue-bg)] text-[var(--tab-popup-action-blue-text)]' : 'bg-[var(--tab-popup-action-neutral-bg)] text-[var(--tab-popup-action-neutral-text)]'} ${aiBusy ? 'cursor-not-allowed opacity-40' : ''}`)}><Pencil className="h-5 w-5" /></button>
            <button type="button" onClick={() => setShowDescEdit(!showDescEdit)} disabled={aiBusy} title={showDescEdit ? t('tooltip.editDescCollapse') : t('tooltip.editDescExpand')} aria-label={showDescEdit ? t('tooltip.editDescCollapse') : t('tooltip.editDescExpand')} className={cn(`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ${showDescEdit ? 'bg-[var(--tab-popup-action-blue-bg)] text-[var(--tab-popup-action-blue-text)]' : 'bg-[var(--tab-popup-action-neutral-bg)] text-[var(--tab-popup-action-neutral-text)]'} ${aiBusy ? 'cursor-not-allowed opacity-40' : ''}`)}><FileText className="h-5 w-5" /></button>
            <button type="button" onClick={() => setIsTodo(!isTodo)} title={isTodo ? t('tooltip.unmarkTodo') : t('tooltip.markTodo')} aria-label={isTodo ? t('tooltip.unmarkTodo') : t('tooltip.markTodo')} className={cn(`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ${isTodo ? 'bg-[var(--tab-popup-action-blue-bg)] text-[var(--tab-popup-action-blue-text)]' : 'bg-[var(--tab-popup-action-neutral-bg)] text-[var(--tab-popup-action-neutral-text)]'}`)}>{isTodo ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}</button>
            <button type="button" onClick={() => setIsPrivate(!isPrivate)} title={isPrivate ? t('tooltip.togglePublic') : t('tooltip.togglePrivate')} aria-label={isPrivate ? t('tooltip.togglePublic') : t('tooltip.togglePrivate')} className={cn(`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150 ${isPrivate ? 'bg-[var(--tab-popup-action-emerald-bg)] text-[var(--tab-popup-action-emerald-text)]' : 'bg-[var(--tab-popup-action-neutral-bg)] text-[var(--tab-popup-action-neutral-text)]'}`)}>{isPrivate ? <Lock className="h-5 w-5" /> : <LockOpen className="h-5 w-5" />}</button>
          </div>
          {(showTitleEdit || showDescEdit) && (
            <div className="mb-2.5 space-y-2">
              {showTitleEdit && (
                <div className="animate-in slide-in-from-top-2 fade-in flex gap-2 duration-200">
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} disabled={aiBusy} placeholder={t('popup.save.titlePlaceholder')} className="flex-1 rounded-xl border border-[var(--tab-popup-input-border)] bg-[var(--tab-popup-input-bg)] px-3 py-2 text-sm text-[var(--tab-popup-input-text)] placeholder:text-[var(--tab-popup-input-placeholder)] focus:border-[var(--tab-popup-input-focus-border)] disabled:opacity-50" />
                  <button type="button" onClick={() => setShowTitleEdit(false)} className="rounded-xl bg-gradient-to-r from-[var(--tab-popup-primary-from)] to-[var(--tab-popup-primary-via)] px-4 py-2 text-sm font-medium text-[var(--tab-popup-primary-text)] shadow-sm transition-all hover:shadow-md active:scale-95">{t('popup.apply')}</button>
                </div>
              )}
              {showDescEdit && (
                <div className="animate-in slide-in-from-top-2 fade-in flex gap-2 duration-200">
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('popup.save.descriptionPlaceholder')} rows={2} disabled={aiBusy} className="flex-1 resize-none rounded-xl border border-[var(--tab-popup-input-border)] bg-[var(--tab-popup-input-bg)] px-3 py-2 text-sm text-[var(--tab-popup-input-text)] placeholder:text-[var(--tab-popup-input-placeholder)] focus:border-[var(--tab-popup-input-focus-border)] disabled:opacity-50" />
                  <button type="button" onClick={() => setShowDescEdit(false)} className="rounded-xl bg-gradient-to-r from-[var(--tab-popup-primary-from)] to-[var(--tab-popup-primary-via)] px-4 py-2 text-sm font-medium text-[var(--tab-popup-primary-text)] shadow-sm transition-all hover:shadow-md active:scale-95">{t('popup.apply')}</button>
                </div>
              )}
            </div>
          )}
          <PageInfoCard title={title || tab.url} url={tab.url} description={description} thumbnail={includeCover ? coverImage : null} thumbnails={includeCover ? thumbnails : undefined} favicon={pageFavicon ?? tab.favIconUrl ?? null} onThumbnailChange={save.handleThumbnailChange} />
        </section>
      )}

      {tab?.url && (
        <SaveTargetBar folders={save.folders} folderId={save.folderId} chooseFolder={save.chooseFolder} aiFolderPath={save.aiFolderPath} aiConfidence={save.aiConfidence} />
      )}

      {recommendedTags.length > 0 && (
        <section className="rounded-xl border border-[var(--tab-popup-section-purple-border)] bg-gradient-to-br from-[var(--tab-popup-section-purple-from)] to-[var(--tab-popup-section-purple-to)] p-3.5 shadow-lg">
          <div className="mb-2.5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--tab-popup-text)]">{t('ai.recommendTitle')}</h2>
              <p className="mt-1 text-xs text-[var(--tab-popup-text-muted)]">{t('ai.recommendDesc')}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {aiEnabled && (
                <button type="button" onClick={() => void save.handleAiDraft()} disabled={aiBusy} title={t('ai.reanalyze')} aria-label={t('ai.reanalyze')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--tab-popup-text-muted)] transition-all hover:bg-[var(--tab-popup-action-neutral-bg)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"><RefreshCw className={cn(`h-3.5 w-3.5 ${aiBusy ? 'animate-spin' : ''}`)} /></button>
              )}
              <span className="rounded-full bg-[var(--tab-popup-section-purple-badge-bg)] px-2 py-0.5 text-xs font-medium text-[var(--tab-popup-section-purple-badge-text)]">{recommendedTags.length}</span>
            </div>
          </div>
          <TagList tags={recommendedTags} selectedNames={selectedTags} onToggle={toggleTag} theme={tagTheme} />
        </section>
      )}

      <section className="rounded-xl border border-[var(--tab-popup-section-emerald-border)] bg-gradient-to-br from-[var(--tab-popup-section-emerald-from)] to-[var(--tab-popup-section-emerald-to)] p-3.5 shadow-lg">
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--tab-popup-text)]"><TagIcon className="h-4 w-4 text-[var(--tab-popup-section-emerald-icon)]" />{t('tag.library')}</h2>
            <p className="mt-1 text-xs text-[var(--tab-popup-text-muted)]">{t('tag.libraryDesc')}</p>
          </div>
          <span className="rounded-full bg-[var(--tab-popup-section-emerald-badge-bg)] px-2 py-0.5 text-xs font-medium text-[var(--tab-popup-section-emerald-badge-text)]">{visibleTags.length}</span>
        </div>
        {visibleTags.length === 0 ? (
          <div className="flex items-center justify-center py-6"><p className="text-xs text-[var(--tab-popup-text-muted)]">{save.loading ? t('popup.loading') : t('popup.noTags')}</p></div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {visibleTags.map((tag) => {
              const isSelected = selectedTags.some((n) => n.toLowerCase() === tag.name.toLowerCase())
              return (
                <button key={tag.id} type="button" onClick={() => toggleTag(tag.name)} className={cn(`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-200 active:scale-95 ${getExistingTagClass(tagTheme, isSelected)}`)}>
                  <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color || 'var(--tab-message-success-icon)' }} />
                  <span className="max-w-[110px] truncate">{tag.name}</span>
                  {tag.count > 0 && <span className="ml-1 text-[10px] opacity-60">({tag.count})</span>}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {save.lastSaveDurationMs !== null && (
        <section className="rounded-xl border border-[var(--tab-popup-section-gray-border)] bg-[var(--tab-popup-section-gray-bg)] p-2.5 text-xs text-[var(--tab-popup-text-muted)] shadow-sm">{t('popup.lastSaveDuration', { sec: (save.lastSaveDurationMs / 1000).toFixed(2) })}</section>
      )}
    </>
  )
}
