// Prerender step: renders the App to a string via the SSR bundle and injects
// it into dist/index.html, so the shipped page carries full content without
// JavaScript (crawler visibility incl. Baidu, first paint before the bundle
// downloads). main.tsx hydrates the same markup at runtime.
import { readFile, writeFile, rm } from 'node:fs/promises'
import { render } from '../dist-ssr/ssr-entry.js'

const INDEX = new URL('../dist/index.html', import.meta.url)
const PLACEHOLDER = '<div id="root"></div>'

const html = await readFile(INDEX, 'utf8')
if (!html.includes(PLACEHOLDER)) {
  throw new Error('prerender: root placeholder not found in dist/index.html')
}
const markup = render()
if (!markup.includes('即刻收纳') || markup.length < 5000) {
  throw new Error('prerender: rendered markup looks empty')
}
await writeFile(INDEX, html.replace(PLACEHOLDER, `<div id="root">${markup}</div>`))
// The SSR bundle was a build tool, not a deploy artifact.
await rm(new URL('../dist-ssr', import.meta.url), { recursive: true, force: true })
console.log(`prerender: injected ${markup.length} chars into dist/index.html`)
