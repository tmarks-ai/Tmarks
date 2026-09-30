import { createRoot } from 'react-dom/client'
import { Popup } from './Popup'
import { ConfirmRoot } from '../lib/ui/confirm'
import '@/styles.css'

// AI 适配器改在首个 AI 调用点动态初始化:popup 每次打开都是冷进程,
// 顶层 init 会把整个 @tmarks/ai(client/prompts/provider)拉进首屏包。

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <>
      <Popup />
      <ConfirmRoot />
    </>
  )
}
