import { renderToString } from 'react-dom/server'
import { App } from './App'

/** Prerender entry: scripts/prerender.mjs calls render() after `vite build
 *  --ssr` bundles this file, and injects the markup into dist/index.html. */
export function render(): string {
  return renderToString(<App />)
}
