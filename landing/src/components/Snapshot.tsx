import { Reveal } from './Reveal'
import { Terminal } from './Terminal'

const BULLETS: { dot: 'live' | 'ai'; text: string }[] = [
  { dot: 'live', text: '自动抓取标题、描述与站点图标' },
  { dot: 'live', text: '离线网页快照，原链接失效亦可回看' },
  { dot: 'ai', text: 'AI 打标签、归类文件夹（自带 Key 可选启用）' },
  { dot: 'live', text: '登录后即时同步至 Cloudflare 边缘节点' },
]

export function Snapshot() {
  return (
    <section className="section" id="snapshot">
      <div className="container split">
        <div className="split__copy">
          <Reveal as="header" className="sec-head">
            <span className="sec-label">// 02 SNAPSHOT</span>
            <h2 className="sec-title">一次点击，<span className="grad">全程留痕</span></h2>
            <p className="sec-sub">收藏不只是存个链接。TMarks 抓取、快照、索引、同步，一气呵成。</p>
          </Reveal>
          <Reveal as="ul" delay={80} className="bullets">
            {BULLETS.map((b, i) => (
              <li key={i}><i className={`dot dot--${b.dot}`} /> {b.text}</li>
            ))}
          </Reveal>
          <Reveal as="div" delay={140} className="status-row">
            <span className="status"><i className="dot dot--live" /> CONNECTED</span>
            <span className="status"><i className="dot dot--live" /> SYNCED</span>
            <span className="status"><i className="dot dot--ai" /> INDEXED</span>
            <span className="status"><i className="dot dot--ai" /> AI_READY</span>
          </Reveal>
        </div>
        <Reveal as="div" delay={120} className="split__visual" aria-hidden>
          <Terminal />
        </Reveal>
      </div>
    </section>
  )
}
