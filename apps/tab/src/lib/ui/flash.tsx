import { useEffect, useState, type ReactElement } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { cn } from './cn'

type FlashMsg = { kind: 'ok' | 'err'; text: string } | null

/** 统一就近反馈:msg 非空时 timeout(默认 3s)后自动清除。替代各 section 散写的 useState+setTimeout。 */
export function useFlash(timeout = 3000): { msg: FlashMsg; flash: (kind: 'ok' | 'err', text: string) => void; clear: () => void } {
  const [msg, setMsg] = useState<FlashMsg>(null)
  useEffect(() => {
    if (!msg) return
    const id = setTimeout(() => setMsg(null), timeout)
    return () => clearTimeout(id)
  }, [msg, timeout])
  return {
    msg,
    flash: (kind, text) => setMsg({ kind, text }),
    clear: () => setMsg(null),
  }
}

/** 反馈药丸:CheckCircle/XCircle + 文本,success/destructive 主题色。就近 3s 显示。 */
export function Flash({ msg, className }: { msg: FlashMsg; className?: string }): ReactElement | null {
  if (!msg) return null
  const ok = msg.kind === 'ok'
  return (
    <p className={cn(
      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium',
      ok ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive',
      className,
    )}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
      {msg.text}
    </p>
  )
}
