import { StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { App } from './App'
import './styles/base.css'
import './styles/sections.css'

// The build prerenders the App's markup into #root (scripts/prerender.mjs);
// hydrate attaches to it. In dev the container is empty, which makes
// hydrateRoot fall back to a normal first mount.
hydrateRoot(
  document.getElementById('root')!,
  <StrictMode>
    <App />
  </StrictMode>,
)
