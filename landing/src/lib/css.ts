import type { CSSProperties } from 'react'

/** Cast a map of CSS custom properties (--var: value) to a React style object. */
export const css = (vars: Record<string, string>): CSSProperties => vars as unknown as CSSProperties
