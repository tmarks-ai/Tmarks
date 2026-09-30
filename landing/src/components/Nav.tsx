import { useEffect, useState } from 'react'
import { CONFIG, hasGitHub } from '../config'
import { GithubIcon } from './GithubIcon'

const NAV_ITEMS = [
  { id: 'features', label: '01 / FEATURES' },
  { id: 'snapshot', label: '02 / SNAPSHOT' },
  { id: 'organize', label: '03 / ORGANIZE' },
  { id: 'sync', label: '04 / SYNC' },
]

export function Nav() {
  const [stuck, setStuck] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState('')

  // Sticky nav state.
  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Scrollspy: highlight the nav link of the section in view.
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const spy = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive((e.target as HTMLElement).id)
        }
      },
      { rootMargin: '-45% 0px -50% 0px', threshold: 0 },
    )
    document.querySelectorAll('main section[id]').forEach((s) => spy.observe(s))
    return () => spy.disconnect()
  }, [])

  // Esc closes the mobile menu (same closure as toggle — no stale-ref bug).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <header className={`nav ${stuck ? 'is-stuck' : ''}`} id="nav">
      <div className="container nav__inner">
        <a className="brand" href="#top" aria-label="TMarks">
          <span className="brand__mark">◆</span>
          <span className="brand__name">TMARKS</span>
          <span className="brand__tag">// AI_BOOKMARK_SYSTEM</span>
        </a>
        <nav className={`nav__links ${open ? 'is-open' : ''}`} aria-label="主导航">
          {NAV_ITEMS.map((it) => (
            <a
              key={it.id}
              href={`#${it.id}`}
              className={active === it.id ? 'is-active' : ''}
              onClick={() => setOpen(false)}
            >
              {it.label}
            </a>
          ))}
        </nav>
        <div className="nav__actions">
          {hasGitHub && (
            <a className="btn btn--primary" href={CONFIG.githubUrl} target="_blank" rel="noopener noreferrer">
              <GithubIcon className="ico" /> GitHub
            </a>
          )}
          <button
            className="nav__burger"
            id="burger"
            aria-label="菜单"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span /><span /><span />
          </button>
        </div>
      </div>
    </header>
  )
}
