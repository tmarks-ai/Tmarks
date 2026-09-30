import { Reveal } from './Reveal'

const TRUST = [
  { dot: 'live', title: 'Cloudflare 边缘', desc: '全球 300+ 节点加速同步，无论身在何处，收藏都触手可及。' },
  { dot: 'live', title: 'HTTPS 加密', desc: '全程 HTTPS 加密传输，你的浏览收藏只属于你自己。' },
  { dot: 'live', title: '多端无缝', desc: '登录同一账号，插件与网页实时同步；换设备也能接着用，数据随你而动。' },
  { dot: 'ai', title: '私有隔离', desc: '私有部署，账户数据严格隔离，你的数据从不混入他人。' },
]

export function Sync() {
  return (
    <section className="section" id="sync">
      <div className="container">
        <Reveal as="header" className="sec-head">
          <span className="sec-label">// 04 SYNC &amp; TRUST</span>
          <h2 className="sec-title">边缘加速，<span className="grad">全程可靠</span></h2>
          <p className="sec-sub">部署于 Cloudflare 全球边缘网络。快、稳、私有。</p>
        </Reveal>
        <div className="trust-grid">
          {TRUST.map((t, i) => (
            <Reveal as="article" key={t.title} delay={i * 80} className="card card--trust">
              <i className={`dot dot--${t.dot}`} />
              <h3>{t.title}</h3>
              <p>{t.desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
