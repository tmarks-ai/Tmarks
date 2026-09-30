import { useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePublicShareSettings, useUpdatePublicShareSettings } from '@/hooks/usePublicShare'
import type { TFunc } from './SettingsSections'
import { SectionHeader } from './SettingPrimitives'

export function PublicShareSection({ t }: { t: TFunc }): React.ReactElement {
  const { data, isLoading } = usePublicShareSettings()
  const update = useUpdatePublicShareSettings()
  const share = data?.share
  const [enabled, setEnabled] = useState(false)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | null>(null)
  // 每个字段的"用户是否改过"标记:refetchOnWindowFocus 的后台刷新回来时,
  // 仅当表单干净才重置——否则切个窗口回来就丢掉正在编辑的内容。
  const dirtyRef = useRef({ enabled: false, slug: false, title: false, description: false })

  useEffect(() => {
    if (!share) return
    if (!dirtyRef.current.enabled) setEnabled(share.enabled)
    if (!dirtyRef.current.slug) setSlug(share.slug ?? '')
    if (!dirtyRef.current.title) setTitle(share.title ?? '')
    if (!dirtyRef.current.description) setDescription(share.description ?? '')
  }, [share])

  useEffect(() => {
    return () => { if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current) }
  }, [])

  const markDirty = (field: keyof typeof dirtyRef.current) => {
    dirtyRef.current[field] = true
  }

  const publicUrl = share?.slug ? `${window.location.origin}/share/${share.slug}` : ''
  // 服务端规则镜像(share/public-share.ts):小写字母/数字/连字符、≥8 字符。
  // 客户端先拦,避免往返后 400;空 slug 属"轮换新链接"的语义,同样按服务端
  // 规则校验长度后放行,但明确提示原链接立即失效。
  const slugError = slug && !/^[a-z0-9-]{8,}$/.test(slug) ? t('share.slugInvalid') : null
  const rotatesSlug = !slug && Boolean(share?.slug)
  const hasDirtyFields = dirtyRef.current.enabled || dirtyRef.current.slug || dirtyRef.current.title || dirtyRef.current.description
  const save = () => {
    if (slugError) return
    update.mutate(
      { enabled, slug: slug || null, title: title || null, description: description || null },
      { onSuccess: () => { dirtyRef.current = { enabled: false, slug: false, title: false, description: false } } }
    )
  }
  const copyLink = async () => {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-6">
      <SectionHeader title={t('tabs.share')} description={t('share.description')} icon={Share2} />
      <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-primary" checked={enabled} onChange={(event) => { markDirty('enabled'); setEnabled(event.target.checked) }} />
        <span><span className="block text-sm font-medium">{t('share.enabled')}</span><span className="mt-1 block text-xs text-muted-foreground">{t('share.enabledHint')}</span></span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('share.slug')}>
          <Input value={slug} onChange={(event) => { markDirty('slug'); setSlug(event.target.value) }} placeholder={t('share.slugPlaceholder')} maxLength={64} />
          {slugError && <p className="mt-1 text-xs text-destructive">{slugError}</p>}
          {rotatesSlug && !slugError && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{t('share.slugRotateWarning')}</p>}
        </Field>
        <Field label={t('share.pageTitle')}><Input value={title} onChange={(event) => { markDirty('title'); setTitle(event.target.value) }} placeholder={t('share.pageTitlePlaceholder')} maxLength={200} /></Field>
      </div>
      <Field label={t('share.pageDescription')}>
        <textarea value={description} onChange={(event) => { markDirty('description'); setDescription(event.target.value) }} placeholder={t('share.pageDescriptionPlaceholder')} maxLength={500} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={isLoading || update.isPending || Boolean(slugError)}>{update.isPending ? t('share.saving') : t('share.save')}</Button>
        {/* dirty 时隐藏反馈:成功提示不能在用户继续编辑后继续挂着(表单是本地
            state、保存按钮是手动的——"已保存"粘滞会让用户以为新编辑也已保存)。 */}
        {!hasDirtyFields && update.isSuccess && <span className="text-sm text-primary">{t('share.saved')}</span>}
        {update.isError && <span className="text-sm text-destructive">{t('share.saveFailed')}</span>}
      </div>
      {publicUrl && enabled ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium">{t('share.publicView')}</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={publicUrl} className="font-mono text-xs" />
            <Button variant="outline" onClick={() => void copyLink()}><Copy className="h-4 w-4" /> {copied ? t('share.copied') : t('share.copyLink')}</Button>
            <Button variant="ghost" asChild><a href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> {t('share.openLink')}</a></Button>
          </div>
        </div>
      ) : <p className="text-sm text-muted-foreground">{t('share.linkDisabled')}</p>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-2"><span className="text-sm font-medium">{label}</span>{children}</label>
}
