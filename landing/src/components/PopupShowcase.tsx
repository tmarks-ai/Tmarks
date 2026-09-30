import { Reveal } from './Reveal'
import { PopupMock } from './PopupMock'

export function PopupShowcase() {
  return (
    <section className="section" id="popup">
      <div className="container split">
        <div className="split__copy">
          <Reveal as="header" className="sec-head">
            <span className="sec-label">// POPUP</span>
            <h2 className="sec-title">点一下图标，<span className="grad">弹窗即开</span></h2>
            <p className="sec-sub">无需跳转新页面。工具栏图标一点，弹窗就地收纳当前页——采集标签页、保存书签、管理我的组，三窗合一。</p>
          </Reveal>
          <Reveal as="ul" delay={80} className="bullets">
            <li><i className="dot dot--live" /> 采集标签页：整窗标签页一键成组，释放内存，随时恢复</li>
            <li><i className="dot dot--live" /> 保存书签：标题 / 描述 / 封面 / 文件夹 / 标签，就地编辑</li>
            <li><i className="dot dot--ai" /> AI 智能归类：一键补全标签与目标文件夹</li>
            <li><i className="dot dot--live" /> 网页快照：离线留存，原链接失效亦可回看</li>
          </Reveal>
        </div>
        <Reveal as="div" delay={120} className="split__visual" aria-hidden>
          <PopupMock />
        </Reveal>
      </div>
    </section>
  )
}
