import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Standalone landing build. Not part of the pnpm workspace / turbo.
// `pnpm build` → dist/ (deploy to Cloudflare Pages, output dir = dist).
//
// SITE_URL (optional, no trailing slash): makes og:url / og:image absolute.
// Social crawlers ignore relative og:image URLs, so production builds should
// run as `SITE_URL=https://tmarks.example.com pnpm build`.
// Read via globalThis so this standalone project needs no @types/node.
const siteUrl = ((globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.SITE_URL ?? '').replace(/\/+$/, '')

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'site-url-inject',
      transformIndexHtml(html) {
        return html.replaceAll('%SITE_URL%', siteUrl)
      },
    },
  ],
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
})
