import { Reveal } from './Reveal'
import { GithubIcon } from './GithubIcon'
import { CONFIG, hasGitHub } from '../config'

export function CtaBanner() {
  return (
    <section className="cta" id="get-started">
      <Reveal as="div" className="container cta__inner">
        <span className="sec-label">// READY</span>
        <h2 className="cta__title">想到，<span className="grad">即刻收纳。</span></h2>
        <p className="cta__sub">免费、快速、由 AI 加持。你的知识库，从下一个标签页开始。</p>
        <div className="hero__cta">
          {hasGitHub && (
            <a className="btn btn--primary btn--lg lp-glow" href={CONFIG.githubUrl} target="_blank" rel="noopener noreferrer">
              <GithubIcon className="ico" /> GitHub
            </a>
          )}
          <a className="btn btn--outline btn--lg" href={CONFIG.extensionUrl}>获取浏览器插件</a>
        </div>
      </Reveal>
    </section>
  )
}
