import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authService } from '@/services/auth'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { SettingGroup } from './SettingPrimitives'
import type { TFunc } from './SettingsSections'

/**
 * 修改密码表单(通用区)。成功后服务端吊销全部会话——包括当前这个——所以
 * 提交成功即登出并跳转登录页,而不是让下一个请求吃一个莫名的 401。
 */
export function PasswordChangeGroup({ t }: { t: TFunc }): React.ReactElement {
  const { t: tc } = useTranslation('common')
  const { logout } = useAuthStore()
  const navigate = useNavigate()
  const toast = useToastStore.getState()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (next.length < 8) {
      setError(t('basic.changePassword.tooShort'))
      return
    }
    if (next !== confirm) {
      setError(t('basic.changePassword.mismatch'))
      return
    }
    setPending(true)
    try {
      await authService.changePassword({ current_password: current, new_password: next })
      toast.success(t('basic.changePassword.changed'))
      await logout()
      navigate('/login', { replace: true })
    } catch (err) {
      // 服务端信息很具体(当前密码不正确/长度限制),直接透出。
      setError(err instanceof Error ? err.message : tc('message.operationFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <SettingGroup icon={KeyRound} title={t('basic.changePassword.title')} description={t('basic.changePassword.description')}>
      <form onSubmit={handleSubmit} className="space-y-2.5">
        <Input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder={t('basic.changePassword.current')}
          aria-label={t('basic.changePassword.current')}
          autoComplete="current-password"
          disabled={pending}
          required
        />
        <Input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder={t('basic.changePassword.new')}
          aria-label={t('basic.changePassword.new')}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          disabled={pending}
          required
        />
        <Input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={t('basic.changePassword.confirm')}
          aria-label={t('basic.changePassword.confirm')}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          disabled={pending}
          required
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" size="sm" variant="outline" disabled={pending || !current || !next}>
          {t('basic.changePassword.submit')}
        </Button>
      </form>
    </SettingGroup>
  )
}
