import { fileURLToPath, URL } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Production-only CSP meta. Injected at build time so Vite's dev pipeline
// (HMR + React refresh inline preamble) stays untouched; self-hosting the
// dist folder then gets the same policy the Worker applies to API responses.
const CSP_META = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function injectCspMeta(): Plugin {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml: (html) => html.replace(
      '</head>',
      `  <meta http-equiv="Content-Security-Policy" content="${CSP_META}" />\n  </head>`,
    ),
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), injectCspMeta()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-router-dom'],
          'i18n-vendor': ['i18next', 'i18next-browser-languagedetector', 'react-i18next'],
          'ui-vendor': [
            'lucide-react',
            'date-fns',
            'zustand',
            '@dnd-kit/core',
            '@dnd-kit/sortable',
            '@dnd-kit/utilities',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-select',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
            '@radix-ui/react-tooltip',
          ],
        },
      },
    },
  },
})