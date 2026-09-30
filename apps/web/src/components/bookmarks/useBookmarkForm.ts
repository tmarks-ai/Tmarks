import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@tmarks/contracts'
import { logger } from '@/lib/logger'
import { useCreateBookmark, useUpdateBookmark, useDeleteBookmark } from '@/hooks/useBookmarks'
import { useCreateTag } from '@/hooks/useTags'
import { tagsService } from '@/services/tags'
import { bookmarksService } from '@/services/bookmarks'
import type {
  BookmarkDTO,
  CreateBookmarkInput,
  TagDTO,
  UpdateBookmarkInput,
} from '@tmarks/contracts'

interface UseBookmarkFormProps {
  bookmark?: BookmarkDTO | null
  onClose: () => void
  onSuccess?: () => void
  tags: TagDTO[]
}

export type UrlMetaStatus = 'idle' | 'fetching' | 'done' | 'error'

/** 书签表单状态与提交逻辑。编辑时仅塞变更字段(减少无用写),创建时全塞。 */
export function useBookmarkForm({ bookmark, onClose, onSuccess, tags }: UseBookmarkFormProps) {
  const { t } = useTranslation('bookmarks')
  const isEditing = Boolean(bookmark)

  const [title, setTitle] = useState(bookmark?.title || '')
  const [url, setUrl] = useState(bookmark?.url || '')
  const [description, setDescription] = useState(bookmark?.description || '')
  const [coverImage, setCoverImage] = useState(bookmark?.cover_image || '')
  const [favicon, setFavicon] = useState(bookmark?.favicon || '')
  const [metaStatus, setMetaStatus] = useState<UrlMetaStatus>('idle')
  const [folderId, setFolderId] = useState<string | null>(bookmark?.folder_id ?? null)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(
    bookmark?.tags.map((tag) => tag.id) || [],
  )
  const [isPinned, setIsPinned] = useState(bookmark?.is_pinned || false)
  const [isTodo, setIsTodo] = useState(bookmark?.is_todo || false)
  const [isPrivate, setIsPrivate] = useState(bookmark?.is_private ?? false)
  const [error, setError] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const createBookmark = useCreateBookmark()
  const updateBookmark = useUpdateBookmark()
  const deleteBookmark = useDeleteBookmark()
  const createTag = useCreateTag()
  const queryClient = useQueryClient()

  /** 409 后绕过 staleTime 强制重取标签列表再找一次(表单里的 tags 是缓存)。 */
  const findTagAfterRefresh = async (name: string): Promise<TagDTO | undefined> => {
    try {
      const data = await queryClient.fetchQuery({
        queryKey: ['tags', undefined],
        queryFn: () => tagsService.getTags(),
        staleTime: 0,
      })
      return (data.tags ?? []).find((tag) => tag.name.toLowerCase() === name.toLowerCase())
    } catch {
      return undefined
    }
  }

  const validateUrl = (urlStr: string) => {
    try {
      const parsed = new URL(urlStr)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  }

  // URL 元数据自动获取:输入合法网址(防抖)后由服务端抓取页面,回填
  // favicon/标题/描述/封面。标题等文本字段仅在为空时回填(不覆盖用户
  // 已输入的内容);favicon 恒以抓取结果为准(与扩展保存行为一致)。
  // 编辑模式下初始 URL 不触发——已存的 favicon 不被无谓重抓。
  const initialUrlRef = useRef(bookmark?.url || '')
  const metaSeqRef = useRef(0)
  // 标签输入的同步互斥闸:见 processTagInput 注释。
  const tagInputPendingRef = useRef(false)
  useEffect(() => {
    const trimmed = url.trim()
    if (!trimmed || trimmed === initialUrlRef.current || !validateUrl(trimmed)) {
      // 递增 seq 使 in-flight 抓取失效:URL 被清空/改成非法后,先前为 A 发出的
      // 响应若再到达,seq 已不匹配 → 不回填(否则"URL=B、标题=A"错配落库)。
      metaSeqRef.current++
      setMetaStatus('idle')
      return
    }
    const seq = ++metaSeqRef.current
    setMetaStatus('fetching')
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { metadata } = await bookmarksService.getUrlMetadata(trimmed)
          if (seq !== metaSeqRef.current) return
          const { title: fetchedTitle, description: fetchedDesc, cover_image: fetchedCover, favicon: fetchedIcon } = metadata
          if (fetchedTitle) setTitle((prev) => prev || fetchedTitle)
          if (fetchedDesc) setDescription((prev) => prev || fetchedDesc)
          if (fetchedCover) setCoverImage((prev) => prev || fetchedCover)
          if (fetchedIcon) setFavicon(fetchedIcon)
          setMetaStatus('done')
        } catch (err) {
          if (seq !== metaSeqRef.current) return
          logger.warn('URL metadata fetch failed:', err)
          setMetaStatus('error')
        }
      })()
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- validateUrl 是无依赖闭包内的稳定逻辑
  }, [url])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!title.trim()) {
      setError(t('form.validation.titleRequired'))
      return
    }
    if (!url.trim()) {
      setError(t('form.validation.urlRequired'))
      return
    }
    if (!validateUrl(url)) {
      setError(t('form.validation.urlInvalid'))
      return
    }
    try {
      if (isEditing && bookmark) {
        const updateData: UpdateBookmarkInput = {
          tag_ids: selectedTagIds,
          folder_id: folderId,
          is_pinned: isPinned,
          is_todo: isTodo,
          is_private: isPrivate,
        }
        if (title.trim() !== (bookmark.title || '')) updateData.title = title.trim()
        if (url.trim() !== (bookmark.url || '')) updateData.url = url.trim()
        if (description.trim() !== (bookmark.description || '')) {
          updateData.description = description.trim() ? description.trim() : null
        }
        if (coverImage.trim() !== (bookmark.cover_image || '')) {
          updateData.cover_image = coverImage.trim() ? coverImage.trim() : null
        }
        if (favicon.trim() !== (bookmark.favicon || '')) {
          updateData.favicon = favicon.trim() ? favicon.trim() : null
        }
        await updateBookmark.mutateAsync({ id: bookmark.id, data: updateData })
      } else {
        const createData: CreateBookmarkInput = {
          title: title.trim(),
          url: url.trim(),
          description: description.trim() ? description.trim() : null,
          cover_image: coverImage.trim() ? coverImage.trim() : null,
          favicon: favicon.trim() ? favicon.trim() : null,
          tag_ids: selectedTagIds,
          folder_id: folderId,
          is_pinned: isPinned,
          is_todo: isTodo,
          is_private: isPrivate,
        }
        await createBookmark.mutateAsync(createData)
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('form.operationFailed'))
    }
  }

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((ids) =>
      ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId],
    )
  }

  /** 处理标签输入:支持中英文逗号分割;已存在复用 id,不存在即时 createTag。 */
  const processTagInput = async () => {
    // 同步闸:isPending 的禁用要等重渲染才生效,双回车会并发跑同一闭包,
    // 后一批的 selectedTagIds 覆盖前一批刚加的选中。ref 闸在同一 tick 拦截。
    if (tagInputPendingRef.current) return
    const input = tagInput.trim()
    if (!input) return
    tagInputPendingRef.current = true
    try {
      const tagNames = input
        .split(/[,，]/)
        .map((name) => name.trim())
        .filter((name) => name.length > 0)
      if (tagNames.length === 0) return
      // Server caps tag names at 50 and would silently truncate — the truncated
      // name then collides with an existing tag (409) and every retry fails the
      // same opaque way. Reject up front with a legible message.
      const overlong = tagNames.find((name) => name.length > 50)
      if (overlong) {
        setError(t('form.validation.tagTooLong', { name: overlong.slice(0, 20) }))
        return
      }
      // 批内大小写不敏感去重:"a, a" 不去重的话第二次 createTag 必 409,
      // 且整批选择被丢弃。
      const seen = new Set<string>()
      const uniqueNames = tagNames.filter((name) => {
        const key = name.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const newSelectedIds = [...selectedTagIds]
      for (const tagName of uniqueNames) {
        let existingTag = tags.find((tag) => tag.name.toLowerCase() === tagName.toLowerCase())
        if (!existingTag) {
          try {
            const newTag = await createTag.mutateAsync({ name: tagName })
            newSelectedIds.push(newTag.id)
            continue
          } catch (err) {
            // 409 = 同名标签已存在,只是表单里的 tags 缓存还是旧的(如上一
            // 次提交刚建过同名标签)。刷新列表后复用,而不是让整批输入失败。
            if (err instanceof ApiError && err.status === 409) {
              existingTag = await findTagAfterRefresh(tagName)
              if (existingTag) {
                if (!newSelectedIds.includes(existingTag.id)) newSelectedIds.push(existingTag.id)
                continue
              }
            }
            logger.error('Failed to create tag:', err)
            setError(t('form.createTagFailed', { name: tagName }))
            return
          }
        }
        if (!newSelectedIds.includes(existingTag.id)) newSelectedIds.push(existingTag.id)
      }
      setSelectedTagIds(newSelectedIds)
      setTagInput('')
    } finally {
      tagInputPendingRef.current = false
    }
  }

  const handleTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void processTagInput()
    }
  }

  const handleDeleteClick = () => setShowDeleteConfirm(true)

  const handleConfirmDelete = async () => {
    if (!bookmark) return
    setShowDeleteConfirm(false)
    try {
      await deleteBookmark.mutateAsync(bookmark.id)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('form.deleteFailed'))
    }
  }

  const isPending =
    createBookmark.isPending ||
    updateBookmark.isPending ||
    deleteBookmark.isPending ||
    createTag.isPending

  return {
    title, setTitle, url, setUrl, description, setDescription, coverImage, setCoverImage,
    favicon, metaStatus,
    folderId, setFolderId, selectedTagIds, toggleTag, isPinned, setIsPinned,
    isTodo, setIsTodo, isPrivate, setIsPrivate,
    error, tagInput, setTagInput, showDeleteConfirm, setShowDeleteConfirm, isPending,
    handleSubmit, handleTagInputKeyDown, processTagInput, handleDeleteClick,
    handleConfirmDelete, isEditing, t,
  }
}
