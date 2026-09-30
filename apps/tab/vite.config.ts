import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json'

// TMark 扩展构建:@crxjs(v2 MV3) 读取 manifest,自动把 TS 入口(background/content)
// 与 HTML 入口(popup/options)打包为可加载的 unpacked 扩展。React 19 + Tailwind v4 对齐 web。
export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest })],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5174 },
  build: { target: 'es2022', emptyOutDir: true },
  // 生产构建剥离 console.log/info(warn/error 保留用于排障)。扩展日志只落在
  // 用户本机控制台、无遥测上报,但避免未来误加的 payload 日志静默随包分发。
  esbuild: { pure: ['console.log', 'console.info', 'console.debug'] },
})
