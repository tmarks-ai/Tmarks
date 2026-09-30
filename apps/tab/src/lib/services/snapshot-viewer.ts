/**
 * 快照查看隔离层。
 *
 * 历史问题:openSelected 直接把后端返回的快照 HTML 用 blob URL 经 chrome.tabs.create
 * 打开,blob 继承扩展 origin(chrome-extension://<id>),任意站点抓来的 HTML 渲染在扩展
 * 特权上下文。MV3 CSP + page-snapshot 剥离 <script> 已阻断脚本执行,但属三层叠加的
 * 纵深防御,任一层放宽即可在扩展 origin 执行脚本→读 chrome.storage 里的 X-API-Key。
 *
 * 现方案:打开的顶层页是本函数生成的"信任包装"(无非受信内容,无脚本),真正的快照 HTML
 * 放进 <iframe sandbox=""> 的 srcdoc。sandbox="" 使 iframe 内容为 opaque origin、脚本禁用、
 * 表单/弹窗/顶级导航全禁,从而与扩展特权完全隔离;相对资源由 page-snapshot 注入的
 * <base href> 仍从原站点经网络加载(图片/CSS 可见,脚本不可执行)。
 */

/** srcdoc 是属性值,需转义 `&` 与 `"` 以保持属性边界;`<` `>` 保留(其内为 HTML 结构)。 */
export function escapeSrcdoc(html: string): string {
  return html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * 构造快照查看包装页:顶层文档无任何受信外输入(标题已转义),仅含一个 sandbox iframe,
 * iframe 的 srcdoc 承载转义后的快照 HTML。返回值用于 URL.createObjectURL(blob)。
 */
export function buildSnapshotViewerHtml(title: string, htmlContent: string): string {
  const safeTitle = title.replace(/</g, '&lt;')
  const srcdoc = escapeSrcdoc(htmlContent)
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${safeTitle}</title>`,
    '<style>html,body{margin:0;padding:0;height:100%;border:0}iframe{display:block;width:100vw;height:100vh;border:0}</style>',
    '</head><body>',
    // sandbox="" 最严格:opaque origin + 脚本/表单/弹窗/导航全禁。不带 allow-same-origin,
    // 故 iframe 内容无法访问父页(扩展 origin)的任何 API 或数据。
    `<iframe sandbox="" srcdoc="${srcdoc}" title="snapshot"></iframe>`,
    '</body></html>',
  ].join('')
}
