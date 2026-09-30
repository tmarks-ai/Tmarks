import { Reveal } from './Reveal'
import { BrowserMock } from './BrowserMock'
import { GithubIcon } from './GithubIcon'
import { CONFIG, hasGitHub } from '../config'

const STEPS = [
  // 与 EXTENSION.md 的权威安装流程一致:扩展开源自托管,从源码构建。
  // 此前第一步指向「网页设置里下载通用包」——两个界面互相指向对方,
  // 但谁都没有托管安装包,用户会走进死胡同。
  { no: '01', title: '构建扩展包', desc: '克隆仓库后执行 pnpm --filter @tmarks/tab build，产物在 apps/tab/dist' },
  { no: '02', title: '打开扩展管理页', desc: '地址栏输入 chrome://extensions/ 或 edge://extensions/' },
  { no: '03', title: '启用开发者模式并加载', desc: '打开「开发者模式」，点「加载已解压的扩展程序」，选择 apps/tab/dist' },
]

export function Install() {
  return (
    <section className="section section--cream" id="install">
      <div className="container split split--rev">
        <div className="split__copy">
          <Reveal as="header" className="sec-head">
            <span className="sec-label">// INSTALL</span>
            <h2 className="sec-title">三步装好<span className="grad">浏览器插件</span></h2>
            <p className="sec-sub">Chrome / Edge / Brave 等 Chromium 内核通用。</p>
          </Reveal>
          <Reveal as="ol" delay={80} className="steps">
            {STEPS.map((s) => (
              <li key={s.no}>
                <b>{s.no}</b>
                <div>
                  <strong>{s.title}</strong>
                  <span>{s.desc}</span>
                </div>
              </li>
            ))}
          </Reveal>
          {hasGitHub && (
            <Reveal as="div" delay={140} className="hero__cta">
              <a className="btn btn--primary btn--lg lp-glow" href={CONFIG.githubUrl} target="_blank" rel="noopener noreferrer">
                <GithubIcon className="ico" /> GitHub
              </a>
            </Reveal>
          )}
        </div>
        <Reveal as="div" delay={120} className="split__visual" aria-hidden>
          <BrowserMock />
        </Reveal>
      </div>
    </section>
  )
}
