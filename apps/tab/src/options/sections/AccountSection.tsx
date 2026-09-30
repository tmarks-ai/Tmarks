import { useState, useEffect, type FormEvent } from 'react'
import { KeyRound, LogOut } from 'lucide-react'
import { clearCredentials, isValidApiKeyFormat, saveCredentials, type Credentials } from '../../lib/api/auth'
import { useI18n } from '../../lib/i18n'
import { Button } from '../../lib/ui/button'
import { confirmDialog } from '../../lib/ui/confirm'
import { BlockHeader } from '../../lib/ui/section'
import { Input } from '../../lib/ui/input'
import { Flash, useFlash } from '../../lib/ui/flash'

interface Props {
  cred: Credentials
  reload: () => Promise<void>
}

/** Configure the one API key shared by the web app and this extension. */
export function AccountSection({ cred, reload }: Props) {
  const { t } = useI18n()
  const [apiKey, setApiKey] = useState(cred.api_key ?? '')
  const [busy, setBusy] = useState(false)
  const { msg, flash } = useFlash()
  const authed = Boolean(cred.api_key)

  // Sync the input when credentials arrive asynchronously (cred starts as {}
  // and is populated by the parent's useEffect after mount).
  useEffect(() => { setApiKey(cred.api_key ?? '') }, [cred.api_key])

  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const trimmed = apiKey.trim()
    if (!trimmed) {
      flash('err', t('account.apiKeyRequired'))
      return
    }
    if (!isValidApiKeyFormat(trimmed)) {
      flash('err', t('account.apiKeyInvalidFormat'))
      return
    }
    setBusy(true)
    try {
      await saveCredentials({ api_key: trimmed })
      flash('ok', t('account.apiKeySaved'))
      await reload()
    } catch {
      flash('err', t('account.apiKeySaveFail'))
    } finally {
      setBusy(false)
    }
  }

  const handleClear = async () => {
    if (busy || !(await confirmDialog({ message: t('account.clearConfirm'), danger: true, confirmText: t('account.clearApiKey') }))) return
    setBusy(true)
    try {
      await clearCredentials()
      setApiKey('')
      await reload()
    } catch {
      flash('err', t('account.clearFail'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <BlockHeader icon={KeyRound} title={t('account.title')} description={t('account.apiKeyDescription')} />
      <form onSubmit={handleSave} className="mt-4 flex flex-col gap-3">
        <Input
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t('account.apiKeyPlaceholder')}
          type="password"
          autoComplete="off"
          className="w-full"
        />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={busy} disabled={!apiKey.trim()}>{t('account.saveApiKey')}</Button>
          {authed && (
            <Button variant="outline" loading={busy} onClick={() => void handleClear()} leading={<LogOut className="h-4 w-4" />}>{t('account.clearApiKey')}</Button>
          )}
        </div>
        <Flash msg={msg} />
      </form>
    </div>
  )
}
