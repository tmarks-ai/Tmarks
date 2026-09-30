import { describe, expect, it } from 'vitest'
import { buildSnapshotViewerHtml, escapeSrcdoc } from '../src/lib/services/snapshot-viewer'

describe('escapeSrcdoc', () => {
  it('escapes & and " to keep the srcdoc attribute boundary intact', () => {
    expect(escapeSrcdoc('a & b "c"')).toBe('a &amp; b &quot;c&quot;')
  })
  it('preserves < > so HTML structure inside srcdoc stays intact', () => {
    expect(escapeSrcdoc('<b>x</b>')).toBe('<b>x</b>')
  })
})

describe('buildSnapshotViewerHtml', () => {
  it('wraps the snapshot in a sandboxed iframe via escaped srcdoc', () => {
    const snapshot = `<script>alert(1)</script><img src="x" onerror="alert(2)">`
    const html = buildSnapshotViewerHtml('Page', snapshot)

    // sandbox="" present → opaque origin + script blocked
    expect(html).toContain('sandbox=""')
    expect(html).toContain('<title>Page</title>')

    // the wrapper document (outside the srcdoc attribute) has no <script> element;
    // the snapshot's <script> lives only as inert text inside the srcdoc attribute.
    const beforeSrcdoc = html.slice(0, html.indexOf('srcdoc="'))
    expect(beforeSrcdoc).not.toContain('<script>')

    // the srcdoc attribute value must contain no unescaped double-quote (no breakout).
    // The closing quote of the srcdoc attribute is the first " after `srcdoc="`.
    const start = html.indexOf('srcdoc="') + 'srcdoc="'.length
    const end = html.indexOf('"', start)
    const inner = html.slice(start, end)
    expect(inner).not.toContain('"')
    // quotes from the snapshot are escaped to &quot; inside srcdoc
    expect(inner).toContain('&quot;')
  })

  it('escapes a malicious title that tries to close the title element early', () => {
    const html = buildSnapshotViewerHtml('</title><script>alert(1)</script>', 'body')
    // attacker's "</title><script>" concatenation must not appear as real markup
    expect(html).not.toContain('</title><script>')
    // the attacker's < is escaped so it cannot open/close a tag inside the title element
    expect(html).toContain('&lt;/title')
    expect(html).toContain('&lt;script')
  })
})
