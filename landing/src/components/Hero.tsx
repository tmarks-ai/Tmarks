import { Reveal } from './Reveal'
import { HeroCharacter } from './HeroCharacter'
import { Marquee } from './Marquee'
import { GithubIcon } from './GithubIcon'
import { CONFIG, hasGitHub } from '../config'

export function Hero() {
  return (
    <section className="hero">
      <div className="container hero__grid">
        <div className="hero__copy">
          <Reveal as="p" className="kicker">
            <span className="bracket">[</span> CONSIDER IT SAVED. <span className="bracket">]</span>
          </Reveal>
          <Reveal as="h1" delay={60} className="hero__title">
            想到，<br /><span className="grad">即刻收纳。</span>
          </Reveal>
          <Reveal as="p" delay={120} className="hero__sub">
            点一下插件，保存书签与整窗标签页；快照按需留存页面原貌；<br className="hide-sm" />文件夹与标签双重组织，AI 整理可选——自带 Key 即用。
          </Reveal>
          <Reveal as="div" delay={180} className="hero__cta">
            {hasGitHub && (
              <a className="btn btn--primary btn--lg lp-glow" href={CONFIG.githubUrl} target="_blank" rel="noopener noreferrer">
                <GithubIcon className="ico" /> GitHub
              </a>
            )}
            <a className="btn btn--outline btn--lg" href={CONFIG.extensionUrl}>获取浏览器插件</a>
          </Reveal>
          <Reveal as="ul" delay={240} className="hero__stats">
            <li><b>01</b><span>一键收藏</span></li>
            <li><b>02</b><span>整窗收纳</span></li>
            <li><b>03</b><span>网页快照</span></li>
            <li><b>04</b><span>AI 整理</span></li>
          </Reveal>
        </div>
        <HeroCharacter />
      </div>
      <Marquee />
    </section>
  )
}
