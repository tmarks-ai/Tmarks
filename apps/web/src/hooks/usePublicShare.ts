import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { publicShareService } from '@/services/public-share'
import { describeMutationError } from '@/lib/describe-error'
import { useToastStore } from '@/stores/toastStore'
import type { UpdatePublicShareSettingsInput } from '@tmarks/contracts'

const SETTINGS_KEY = 'public-share-settings'

export function usePublicShareSettings() {
  return useQuery({
    queryKey: [SETTINGS_KEY],
    queryFn: () => publicShareService.getSettings(),
    staleTime: 30 * 1000,
  })
}

export function useUpdatePublicShareSettings() {
  const queryClient = useQueryClient()
  const { t } = useTranslation('common')
  const toast = useToastStore.getState()
  return useMutation({
    mutationFn: (input: UpdatePublicShareSettingsInput) => publicShareService.updateSettings(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] }),
    // 服务端错误很具体(slug 字符集/长度不足/已被占用 409),只给通用"保存失败"
    // 用户无从修正——与 useBookmarks/useApiKeys 同款透出具体原因。
    onError: (error) => toast.error(describeMutationError(error, t)),
  })
}
