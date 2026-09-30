import { css } from '../lib/css'

export function BrowserMock() {
  return (
    <div className="browser">
      <div className="browser__bar">
        <span className="mock__dot r" /><span className="mock__dot y" /><span className="mock__dot g" />
        <span className="browser__url">chrome://extensions</span>
        <span className="browser__badge"><i className="dot dot--live" /> DEV MODE</span>
      </div>
      <div className="browser__body">
        <div className="ext-row ext-row--on">
          <span className="favicon" style={css({ '--c': '#f43d3f' })}>◆</span>
          <div className="ext-row__meta">
            <strong>TMark<span className="ext-ver">0.1.0</span></strong>
            <span>采集标签页并同步到 TMark</span>
            <div className="ext-perms"><span>tabs</span><span>storage</span><span>fetch</span></div>
          </div>
          <span className="ext-pill">已启用</span>
        </div>
        <div className="ext-dropzone">将解压后的文件夹拖到此处<br />即可加载 TMark</div>
        <div className="ext-row ext-row--ghost">
          <span className="favicon ghost">＋</span>
          <div className="ext-row__meta">
            <strong>加载已解压的扩展程序</strong>
            <span>选择解压后的 TMark 文件夹</span>
          </div>
        </div>
      </div>
    </div>
  )
}
