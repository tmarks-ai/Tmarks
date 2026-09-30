/** Extension popup mock — faithful to the real TMark popup (header + 3 panes
 *  采集标签页 / 保存书签 / 我的组 + save form). Fixed light palette so it reads
 *  as a real popup floating over the ink section. Decorative (aria-hidden). */
export function PopupMock() {
  return (
    <div className="popup" aria-hidden>
      <div className="popup__head">
        <span className="popup__logo">◆</span>
        <span className="popup__name">TMark</span>
        <span className="popup__sync"><span className="popup__dot" /> 已同步</span>
        <span className="popup__gear">⚙</span>
      </div>
      <div className="popup__tabs">
        <span className="popup__tab">采集标签页</span>
        <span className="popup__tab is-on">保存书签</span>
        <span className="popup__tab">我的组</span>
      </div>
      <div className="popup__card">
        <span className="popup__fav">▣</span>
        <div className="popup__card-meta">
          <strong>2026 设计灵感 · 配色趋势</strong>
          <span>cindy.cn/inspiration</span>
        </div>
      </div>
      <div className="popup__input">2026 设计灵感 · 配色趋势</div>
      <p className="popup__desc">收录 2026 年配色趋势与排版灵感，离线快照留存，原链接失效亦可回看。</p>
      <div className="popup__field">
        <span className="popup__field-label">归档至</span>
        <span className="popup__field-value">收藏夹 / 设计灵感</span>
        <span className="popup__caret">▾</span>
      </div>
      <div className="popup__chips">
        <span className="popup__chip">设计</span>
        <span className="popup__chip">灵感</span>
        <span className="popup__chip popup__chip--ai">＋ 配色</span>
      </div>
      <div className="popup__snap"><span className="popup__snap-label">网页快照</span><span className="popup__toggle" /></div>
      <button type="button" className="popup__btn popup__btn--ai">✦ AI 智能归类</button>
      <button type="button" className="popup__btn popup__btn--save">保存到「设计灵感」</button>
    </div>
  )
}
