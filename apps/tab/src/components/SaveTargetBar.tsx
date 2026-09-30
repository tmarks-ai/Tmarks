import { cn } from '../lib/utils/cn'
import { useMemo } from 'react'
import { Folder } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../lib/ui/select'
import { buildFolderTree, flattenFolders } from '../lib/utils/folder-tree'
import { useI18n } from '../lib/i18n'
import type { LocalFolder } from '../lib/db'

const ROOT_VALUE = '__root__'
const AI_VALUE = '__ai__'

interface Props {
  folders: LocalFolder[]
  folderId: string | null
  chooseFolder: (id: string | null) => void
  aiFolderPath: string[]
  aiConfidence: number | null
  disabled?: boolean
}

/** 保存目标栏:显示并更改 AI 建议或用户手选的保存文件夹(1/2 级)。
 *  AI 路径非空时默认为保存目标(带"AI 建议"标记),用户从下拉选已有文件夹后清空 AI 路径,用户选择优先。 */
export function SaveTargetBar({ folders, folderId, chooseFolder, aiFolderPath, aiConfidence, disabled }: Props) {
  const { t } = useI18n()
  const folderOptions = useMemo(() => flattenFolders(buildFolderTree(folders)), [folders])
  // AI 建议路径可能与已有文件夹完全重合:计算每个文件夹的完整路径段,若 AI 路径命中已有文件夹,
  // 直接选用该文件夹(消除"Dev/React〔AI 建议〕"与"Dev/React"并存歧义),不再渲染合成 AI 项。
  // 匹配口径与保存路径 ensureBookmarkFolderPath 同步:大小写不敏感 + 只取前两级
  // (3 级以上 AI 输出实际会落库到其前两级),否则显示的目标与真实写入分叉。
  const matchingValue = useMemo(() => {
    if (aiFolderPath.length === 0) return null
    const target = aiFolderPath.slice(0, 2)
    const byId = new Map(folders.map((f) => [f.id, f]))
    const pathOf = (id: string, seen = new Set<string>()): string[] => {
      if (seen.has(id)) return [] // 防御:父链成环(sync 冲突等脏数据)时避免无限递归
      seen.add(id)
      const f = byId.get(id)
      if (!f) return []
      if (!f.parent_id) return [f.name]
      return [...pathOf(f.parent_id, seen), f.name]
    }
    for (const f of folders) {
      const segs = pathOf(f.id).slice(0, 2)
      if (segs.length === target.length && segs.every((s, i) => s.toLowerCase() === target[i]!.toLowerCase())) return f.id
    }
    return null
  }, [folders, aiFolderPath])
  const hasAi = aiFolderPath.length > 0 && matchingValue === null
  const selectValue = hasAi ? AI_VALUE : matchingValue ?? folderId ?? ROOT_VALUE
  const aiLabel = hasAi ? `${aiFolderPath.join(' / ')}  〔${t('popup.aiFolderSuggest')}〕` : ''

  const handleChange = (val: string): void => {
    if (val === AI_VALUE) return // 维持 AI 建议,无操作
    chooseFolder(val === ROOT_VALUE ? null : val)
  }

  const lowConfidence = hasAi && aiConfidence != null && aiConfidence < 0.5

  return (
    <section className="rounded-xl border border-[var(--tab-popup-save-target-border)] bg-[var(--tab-popup-save-target-bg)] p-3 shadow-lg">
      <div className="flex items-center gap-2">
        <Folder className="h-4 w-4 shrink-0 text-[var(--tab-popup-save-target-icon)]" />
        <span className="shrink-0 text-xs font-medium text-[var(--tab-popup-save-target-text)]">{t('popup.saveTo')}</span>
        <Select value={selectValue} onValueChange={handleChange} disabled={disabled}>
          <SelectTrigger className="h-8 flex-1 border-[var(--tab-popup-save-target-border)] bg-transparent px-2 text-xs text-[var(--tab-popup-save-target-text)] hover:bg-[var(--tab-popup-save-target-badge-bg)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {hasAi && (
              <SelectItem value={AI_VALUE}>{aiLabel}</SelectItem>
            )}
            <SelectItem value={ROOT_VALUE}>{t('popup.saveToRoot')}</SelectItem>
            {folderOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasAi && aiConfidence != null && (
          <span className={cn(`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${lowConfidence ? 'bg-[var(--tab-popup-save-target-badge-bg)] text-[var(--tab-popup-save-target-badge-text)]' : 'text-[var(--tab-popup-text-muted)]'}`)}>
            {t('popup.aiConfidence', { pct: Math.round(aiConfidence * 100) })}
          </span>
        )}
      </div>
      {lowConfidence && (
        <p className="mt-1.5 text-[11px] text-[var(--tab-popup-save-target-badge-text)]">{t('popup.aiLowConfidence')}</p>
      )}
    </section>
  )
}
