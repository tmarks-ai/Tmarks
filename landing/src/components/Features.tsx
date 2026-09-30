import { Reveal } from './Reveal'

interface Feature {
  no: string
  status: 'LIVE' | 'AGENT' | 'SYNC'
  dot: 'live' | 'ai'
  title: string
  desc: string
  tag: string
}

const FEATURES: Feature[] = [
  { no: '01', status: 'LIVE', dot: 'live', title: '一键添加书签', desc: '点击插件即可收藏当前页面，自动抓取标题、描述与网站图标，无需手动填写。', tag: 'INSTANT_BOOKMARK' },
  { no: '02', status: 'LIVE', dot: 'live', title: '一键收纳标签页', desc: '整窗标签页秒变「标签页组」，释放内存；随时一键恢复，或全部重新打开。', tag: 'TAB_GROUP_STASH' },
  { no: '03', status: 'LIVE', dot: 'live', title: '网页快照', desc: '离线留存页面原始样貌。即便原链接失效，也能随时回看，不再怕 404（自托管需启用对象存储）。', tag: 'PAGE_SNAPSHOT' },
  { no: '04', status: 'LIVE', dot: 'live', title: '文件夹与标签', desc: '两级文件夹 + 自由标签，双重维度组织你的收藏宇宙，找得到、理得清。', tag: 'FOLDERS_TAGS' },
  { no: '05', status: 'AGENT', dot: 'ai', title: 'AI 智能整理', desc: '自带服务商 Key（BYOK）即可启用：AI 自动归类、补全描述、推荐标签，密钥只留本地、不经服务端。', tag: 'AI_ORGANIZE' },
  { no: '06', status: 'SYNC', dot: 'live', title: '多端同步', desc: '登录同一账号后，插件与网页经 Cloudflare 边缘实时同步；未登录也可纯本地使用。', tag: 'EDGE_SYNC' },
]

export function Features() {
  return (
    <section className="section section--cream" id="features">
      <div className="container">
        <Reveal as="header" className="sec-head">
          <span className="sec-label">// 01 INSTANT_COLLECT</span>
          <h2 className="sec-title">为收藏而生，因 <span className="grad">AI</span> 而简</h2>
          <p className="sec-sub">六大能力，覆盖从灵感到归档的每一步。一切，发生在一次点击之间。</p>
        </Reveal>
        <div className="feat-grid">
          {FEATURES.map((f, i) => (
            <Reveal as="article" key={f.no} delay={(i % 3) * 80} className="card">
              <div className="card__top">
                <span className="card__no">{f.no}</span>
                <i className={`dot dot--${f.dot}`} /> {f.status}
              </div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              <code className="card__tag">{f.tag}</code>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
