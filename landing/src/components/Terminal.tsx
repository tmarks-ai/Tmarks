export function Terminal() {
  return (
    <div className="term">
      <div className="term__bar">
        <span className="term__dot r" /><span className="term__dot y" /><span className="term__dot g" />
        <span className="term__title">~/tmarks — zsh</span>
      </div>
      <div className="term__body">
        <div className="term__line"><span className="t-prompt">$</span> tmarks collect --window</div>
        <div className="term__line">
          <span className="t-ok">✔</span> collected <span className="t-num">12</span> tabs → <span className="t-str">"前端框架调研"</span>
        </div>
        <div className="term__line"><span className="t-ok">✔</span> snapshot saved <span className="t-dim">(2.4 MB)</span></div>
        <div className="term__line"><span className="t-ok">✔</span> synced to <span className="t-acc">cloudflare edge</span></div>
        <div className="term__line">
          <span className="t-agent">[AGENT]</span> auto-tagged: <span className="t-chip">#dev</span> <span className="t-chip">#research</span> <span className="t-chip">#前端</span>
        </div>
        <div className="term__line"><span className="t-agent">[AGENT]</span> filed into <span className="t-str">"开发资源 / 前端"</span></div>
        <div className="term__line"><span className="t-prompt">$</span> <span className="t-cursor">▋</span></div>
      </div>
    </div>
  )
}
