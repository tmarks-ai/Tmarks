import { Component, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import i18n from '@/i18n'
import { logger } from '@/lib/logger'

interface Props {
  children: ReactNode
  /**
   * 'full' (default): standalone full-screen error page (the app-root
   * boundary). 'content': an in-place block for route-level boundaries —
   * R5-14 — sized to the shell's content area so the surrounding navigation
   * stays interactive.
   */
  variant?: 'full' | 'content'
}

interface State {
  hasError: boolean
  message?: string
  copied: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, copied: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message, copied: false }
  }

  override componentDidCatch(error: Error) {
    logger.error('ErrorBoundary caught:', error)
  }

  private readonly handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(this.state.message ?? '')
      this.setState({ copied: true })
      window.setTimeout(() => this.setState({ copied: false }), 2000)
    } catch (error) {
      logger.error('ErrorBoundary copy failed:', error)
    }
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div
          className={
            this.props.variant === 'content'
              ? 'flex min-h-[50vh] items-center justify-center p-4'
              : 'flex min-h-screen items-center justify-center p-4'
          }
        >
          <div className="text-center">
            <h1 className="text-2xl font-bold text-destructive">
              {i18n.t('common:errorBoundary.title')}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {this.state.message ?? i18n.t('common:errorBoundary.description')}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground"
              >
                {i18n.t('common:errorBoundary.refresh')}
              </button>
              <button
                onClick={this.handleCopy}
                className="px-4 py-2 rounded-lg border border-border text-foreground hover:bg-accent"
              >
                {this.state.copied
                  ? i18n.t('common:button.copied')
                  : i18n.t('common:action.copyError')}
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

/**
 * Route-level boundary (R5-14): the pre-fix single app-root boundary never
 * reset, so any page render error (or a failed lazy() chunk load) blanked the
 * entire shell including navigation, and recovery meant a full reload — which
 * also dropped the in-memory access token. Keying by pathname gives each
 * route its own boundary and clears the error state the moment the user
 * navigates; only the content area is replaced, so the shell stays usable.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary key={pathname} variant="content">
      {children}
    </ErrorBoundary>
  )
}
