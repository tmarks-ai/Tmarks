import { Reveal } from './Reveal'

const NODES = [
  { no: '01 / COLLECT', title: '一键收藏', desc: '浏览时点一下插件，保存书签或收纳整窗标签页，自动同步上云。', arrow: true },
  { no: '02 / ORGANIZE', title: '整理归档', desc: '文件夹 + 标签 + AI 自动归类，把零散的灵感组织成你的知识库。', arrow: true },
  { no: '03 / RECALL', title: '随时回看', desc: '关键字搜索、标签筛选、快照离线回看；想找的，一秒就到。', arrow: false },
]

export function Organize() {
  return (
    <section className="section section--cream" id="organize">
      <div className="container">
        <Reveal as="header" className="sec-head">
          <span className="sec-label">// 03 ORGANIZE</span>
          <h2 className="sec-title">三步，把浏览<span className="grad">变成收藏</span></h2>
          <p className="sec-sub">从采集到回看，流畅得像呼吸。不是流水线，而是你的知识网络。</p>
        </Reveal>
        <ol className="flow">
          {NODES.map((n, i) => (
            <Reveal as="li" key={n.no} delay={i * 100} className="flow__node">
              <div className="flow__no">{n.no}</div>
              <h3>{n.title}</h3>
              <p>{n.desc}</p>
              {n.arrow && <span className="flow__arrow" aria-hidden>→</span>}
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
