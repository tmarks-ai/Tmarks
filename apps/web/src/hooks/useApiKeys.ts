import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { apiKeysService } from '@/services/api-keys'
import { useToastStore } from '@/stores/toastStore'
import { describeMutationError } from '@/lib/describe-error'
import type { ApiKeyCreateRequest } from '@tmarks/contracts'

const QUERY_KEY = 'api-keys'

/** mutation 失败统一提示(按错误类型分级文案)。 */
function useMutationErrorToast() {
  const { t } = useTranslation('common')
  const toast = useToastStore.getState()
  return (error?: unknown) => toast.error(describeMutationError(error, t))
}

export function useApiKeys() {
  return useQuery({
    queryKey: [QUERY_KEY],
    queryFn: () => apiKeysService.listApiKeys(),
    staleTime: 60 * 1000,
  })
}

export function useCreateApiKey() {
  const qc = useQueryClient()
  const onError = useMutationErrorToast()
  return useMutation({
    mutationFn: (data: ApiKeyCreateRequest) => apiKeysService.createApiKey(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
    onError,
  })
}

export function useRevokeApiKey() {
  const qc = useQueryClient()
  const onError = useMutationErrorToast()
  return useMutation({
    mutationFn: (id: string) => apiKeysService.revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
    onError,
  })
}
