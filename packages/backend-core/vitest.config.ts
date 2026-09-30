import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    passWithNoTests: true,
    server: {
      // `node:sqlite` is a builtin without a bundled shim; Vite must leave the
      // import alone so the real SQLite engine backs the migration harness.
      deps: { external: [/^node:sqlite$/] },
    },
  },
})
