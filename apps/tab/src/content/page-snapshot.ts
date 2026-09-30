export interface PageSnapshot {
  title: string
  url: string
  html_content: string
}

const MAX_HTML_LENGTH = 6_000_000

/** Attribute names that carry URLs; values must survive a protocol whitelist. */
const URL_ATTRIBUTES = /^(href|src|poster|action|formaction|xlink:href)$/i

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value, location.href)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Clone the rendered DOM and remove executable/embedded contexts before
 * upload. Script-ish nodes are dropped entirely; URL attributes are kept only
 * for http(s) (URL parsing also normalizes control characters inside the
 * scheme, closing the `java\tscript:` bypass); external stylesheets are
 * removed and `@import` rules are stripped from inline styles so viewing a
 * snapshot cannot trigger fetches to the original page or third parties.
 */
export function capturePageSnapshot(): PageSnapshot {
  const clone = document.documentElement.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script, noscript, iframe, object, embed, link[rel="stylesheet"]').forEach((node) => node.remove())

  // 纵深防御:即便查看侧已用 sandbox iframe 隔离,存储到 R2 的 HTML 也应去除可执行痕迹。
  // 剥离 <meta refresh> + 内联事件处理器(on*)+ 非 http(s) 的 URL 属性,使快照静态化。
  clone.querySelectorAll('meta[http-equiv]').forEach((meta) => {
    if (/^\s*refresh\s*$/i.test(meta.getAttribute('http-equiv') ?? '')) meta.remove()
  })
  clone.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('on')) {
        el.removeAttribute(attr.name)
      } else if (URL_ATTRIBUTES.test(attr.name) && !isHttpUrl(attr.value)) {
        el.removeAttribute(attr.name)
      }
    }
  })
  clone.querySelectorAll('style').forEach((style) => {
    const text = style.textContent ?? ''
    const withoutImports = text.replace(/@import[^;]*;?/gi, '')
    if (withoutImports.trim()) {
      style.textContent = withoutImports
    } else {
      style.remove()
    }
  })
  clone.querySelectorAll('img').forEach((image) => {
    const source = image.currentSrc || image.src
    if (source) image.setAttribute('src', source)
    image.removeAttribute('srcset')
    image.removeAttribute('loading')
  })
  const head = clone.querySelector('head')
  if (head && !head.querySelector('base')) {
    const base = document.createElement('base')
    base.href = location.href
    head.prepend(base)
  }
  const html = `<!doctype html>\n${clone.outerHTML}`
  return { title: document.title || location.href, url: location.href, html_content: html.slice(0, MAX_HTML_LENGTH) }
}