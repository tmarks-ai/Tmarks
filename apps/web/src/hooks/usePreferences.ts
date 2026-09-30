import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { preferencesService } from '@/services/preferences'
import { useToastStore } from '@/stores/toastStore'
import { describeMutationError } from '@/lib/describe-error'
import type { UpdatePreferencesInput } from '@tmarks/contracts'

const QUERY_KEY = 'preferences'

export function usePreferences() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: () => preferencesService.getPreferences(),
    staleTime: 30 * 1000,
  })
}

export function useUpdatePreferences() {
  const qc = useQueryClient()
  const { t } = useTranslation('common')
  const toast = useToastStore.getState()
  return useMutation({
    mutationFn: (data: UpdatePreferencesInput) => preferencesService.updatePreferences(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
    // 工作区 page_size 快捷修改没有内联反馈,失败必须 toast——否则静默回滚。
    onError: (error) => toast.error(describeMutationError(error, t)),
  })
}
