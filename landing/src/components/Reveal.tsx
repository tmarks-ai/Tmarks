import { useEffect, useLayoutEffect, useRef, useState, type ElementType, type ReactNode } from 'react'

interface RevealProps {
  as?: ElementType
  delay?: number
  className?: string
  children?: ReactNode
  'aria-hidden'?: boolean
}

// useLayoutEffect warns during SSR; the effect itself never runs on the server.
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Reveal a block as it scrolls into view. Polymorphic via `as` so it keeps
 *  the real tag (article/li/header/ul/...) and CSS direct-child selectors
 *  stay intact. Respects prefers-reduced-motion (shows immediately).
 *
 *  Progressive enhancement: the server render (and any no-JS visitor) ships
 *  the block visible. Once JS hydrates, the pre-paint effect hides everything
 *  still below the viewport so IntersectionObserver can replay the slide-in —
 *  the user never sees a hide/show flicker. Blocks already scrolled past are
 *  treated as shown so they cannot get stuck hidden. */
export function Reveal({ as, delay = 0, className = '', children, ...rest }: RevealProps) {
  const Tag = (as ?? 'div') as ElementType
  const ref = useRef<HTMLElement | null>(null)
  // Start visible: this is what the prerendered HTML captures.
  const [shown, setShown] = useState(true)

  useBrowserLayoutEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const el = ref.current
    if (!el) return
    // Reveal line: 92% of the viewport height (the CSS rootMargin -8% twin).
    const line = () => window.innerHeight * 0.92
    // Below the reveal line: hide now (before paint) so it can slide in
    // later. Above it: stays visible. IntersectionObserver is deliberately
    // NOT used — anchor jumps move a block from below the viewport to above
    // it without an intersecting state in between, so IO never fires and the
    // block would stay hidden. A rAF-throttled scroll check has no blind spot.
    if (el.getBoundingClientRect().top > line()) setShown(false)
    let ticking = false
    const check = () => {
      ticking = false
      if (el.getBoundingClientRect().top < line()) {
        setShown(true)
        window.removeEventListener('scroll', onScroll)
      }
    }
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(check)
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${shown ? 'is-in' : ''} ${className}`.trim()}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  )
}
