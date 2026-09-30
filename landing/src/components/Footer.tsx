import { CONFIG, hasGitHub } from '../config'
import { GithubIcon } from './GithubIcon'

const YEAR = new Date().getFullYear()

export function Footer() {
  return (
    <footer className="footer">
      {/* The resources column collapses entirely while githubUrl is unset —
          a one-link column reads as unfinished, and the grid drops to two
          columns via footer__grid--duo. */}
      <div className={`container footer__grid${hasGitHub ? '' : ' footer__grid--duo'}`}>
        <div className="footer__brand">
          <a className="brand" href="#top">
            <span className="brand__mark">◆</span>
            <span className="brand__name">TMARKS</span>
          </a>
          <p className="footer__line">让灵感，随取随藏。</p>
          <p className="footer__meta">// AI_BOOKMARK_SYSTEM</p>
        </div>
        <nav className="footer__col" aria-label="产品">
          <h4>产品</h4>
          <a href="#features">功能</a><a href="#snapshot">快照</a><a href="#organize">工作流</a><a href="#sync">同步</a>
        </nav>
        {hasGitHub && (
          <nav className="footer__col" aria-label="资源">
            <h4>资源</h4>
            <a href="#install">浏览器插件</a>
            <a href={CONFIG.githubUrl} target="_blank" rel="noopener noreferrer"><GithubIcon className="ico" />GitHub</a>
          </nav>
        )}
      </div>
      <div className="container footer__bottom">
        <span><i className="dot dot--live" /> POWERED_BY CLOUDFLARE</span><span className="sep">◆</span>
        <span>© {YEAR} TMarks</span><span className="sep">◆</span>
        <span className="muted">// BUILT_WITH_CARE</span>
      </div>
      <div className="footer__wordmark" aria-hidden>TMARKS</div>
      <div className="footer__cat" aria-hidden>
        <img src={CONFIG.footerChara} alt="" draggable={false} />
      </div>
    </footer>
  )
}
