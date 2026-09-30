import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    globals: true,
    // Workspace source packages (type-only, no build step) must be
    // inline-transformed; vitest 4 changed the externalization default and
    // re-exports from @tmarks/* silently produced empty modules in jsdom.
    server: {
      deps: {
        inline: [/\/@tmarks\//, /\/packages\//],
      },
    },
  },
})
