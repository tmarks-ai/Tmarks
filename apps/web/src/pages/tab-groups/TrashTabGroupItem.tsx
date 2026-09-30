import { useTranslation } from 'react-i18next'
import { Calendar, Folder, RotateCcw, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { TabGroupDTO } from '@tmarks/contracts'
import { dateFnsLocale } from '@/lib/locale'
import { Button } from '@/components/ui/button'

interface TrashTabGroupItemProps {
  group: TabGroupDTO
  onRestore: (id: string, title: string) => void
  onDelete: (id: string, title: string) => void
}

/** 回收站单条:文件夹图标 + 标题 + 相对删除时间 + 恢复/永久删除按钮。 */
export function TrashTabGroupItem({ group, onRestore, onDelete }: TrashTabGroupItemProps) {
  const { t, i18n } = useTranslation('tabGroups')
  const dateLocale = dateFnsLocale(i18n.language)
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border/60 bg-card/95 p-4 transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Folder className="h-6 w-6 flex-shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <h3 className="mb-1 truncate text-lg font-semibold text-foreground">{group.title}</h3>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>
              {t('trash.deletedAt', {
                time: group.deleted_at
                  ? formatDistanceToNow(new Date(group.deleted_at), { addSuffix: true, locale: dateLocale })
                  : '',
              })}
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onRestore(group.id, group.title)}>
          <RotateCcw className="h-4 w-4" />
          {t('trash.restore')}
        </Button>
        <Button variant="destructive" size="sm" onClick={() => onDelete(group.id, group.title)}>
          <Trash2 className="h-4 w-4" />
          {t('trash.deletePermanently')}
        </Button>
      </div>
    </div>
  )
}
