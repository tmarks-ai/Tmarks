import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { TabGroupDTO } from '@tmarks/contracts'
import { TAB_GROUP_COLORS } from '@/lib/constants/tab-groups'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface ColorTagEditorProps {
  isOpen: boolean
  group: TabGroupDTO | null
  isSubmitting: boolean
  onConfirm: (color: string | null, tags: string[]) => void
  onCancel: () => void
}

const sameTags = (a: string[] | undefined, b: string[]) =>
  Array.isArray(a) && a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')

/** 镜像服务端静默截断上限(group-id.ts:前 50 个标签、每个截 50 字符):客户端
 * 先拒绝,否则第 51 个标签/超长尾在"应用成功"后凭空消失。 */
const MAX_TAGS = 50
const MAX_TAG_LENGTH = 50

/** 颜色/标签编辑对话框:色板选择(含无色)+ 标签 chips(回车添加 / 点 x 移除)+ 应用按钮 dirty 时启用。 */
export function ColorTagEditor({ isOpen, group, isSubmitting, onConfirm, onCancel }: ColorTagEditorProps) {
  const { t } = useTranslation('tabGroups')
  const { t: tc } = useTranslation('common')
  const [color, setColor] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    if (isOpen && group) {
      setColor(group.color)
      setTags(group.tags ?? [])
      setTagInput('')
    }
  }, [isOpen, group])

  const addTag = () => {
    const v = tagInput.trim().slice(0, MAX_TAG_LENGTH)
    if (v && !tags.includes(v) && tags.length < MAX_TAGS) setTags((prev) => [...prev, v])
    setTagInput('')
  }
  const removeTag = (tag: string) => setTags((prev) => prev.filter((x) => x !== tag))

  const dirty = color !== (group?.color ?? null) || !sameTags(group?.tags, tags)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel() }}>
      <DialogContent closeLabel={tc('button.close')}>
        <DialogHeader>
          <DialogTitle>{t('colorTag.title')}</DialogTitle>
          <DialogDescription>{t('colorTag.description', { title: group?.title ?? '' })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">{t('colorTag.color')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setColor(null)}
                className={cn(`flex h-7 w-7 items-center justify-center rounded-full border-2 ${color === null ? 'border-primary' : 'border-border'}`)}
                title={t('colorTag.noColor')}
                aria-label={t('colorTag.noColor')}
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
              {TAB_GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(`h-7 w-7 rounded-full border-2 ${color === c ? 'border-primary ring-2 ring-primary/30' : 'border-transparent'}`)}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-foreground">{t('colorTag.tags')}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="text-muted-foreground hover:text-destructive" aria-label={t('colorTag.removeTag', { tag })}>
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
                placeholder={t('colorTag.tagPlaceholder')}
                className="h-8 min-w-24 flex-1 rounded-full border border-border bg-transparent px-3 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
            {tc('button.cancel')}
          </Button>
          <Button onClick={() => onConfirm(color, tags)} disabled={isSubmitting || !dirty} showPendingIndicator>
            {t('colorTag.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
