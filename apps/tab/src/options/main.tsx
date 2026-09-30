import { createRoot } from 'react-dom/client'
import { Options } from './Options'
import { ConfirmRoot } from '../lib/ui/confirm'
import { initAIStorage } from '../lib/ai/ai-storage'
import '@/styles.css'

initAIStorage()

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <>
      <Options />
      <ConfirmRoot />
    </>
  )
}
