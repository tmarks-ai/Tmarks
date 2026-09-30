import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repo root: <repo>/scripts/.. — portable across checkouts.
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '')
const SRC_ROOTS = ['apps/web/src', 'apps/tab/src', 'apps/worker/src', 'packages/contracts/src', 'packages/backend-core/src', 'packages/ai/src']
// Test dirs are scanned as EXTERNAL consumers (so test-only-used exports aren't
// wrongly flagged dead), but their own exports are NOT audited.
const TEST_ROOTS = ['apps/tab/test', 'packages/ai/test', 'packages/backend-core/test']

const isCode = (n) => /\.[tj]sx?$/.test(n) && !/\.d\.ts$/.test(n.name === undefined ? n : n)
const srcFiles = []
const testFiles = []
function walkSrc(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkSrc(p); else if (isCode(e.name) && !/\.test\.[tj]sx?$/.test(e.name)) srcFiles.push(p) } }
function walkTest(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walkTest(p); else if (isCode(e.name)) testFiles.push(p) } }
for (const r of SRC_ROOTS) walkSrc(path.join(ROOT, r))
for (const r of TEST_ROOTS) { const d = path.join(ROOT, r); if (fs.existsSync(d)) walkTest(d) }

const files = [...srcFiles, ...testFiles]
const contents = new Map()
for (const f of files) contents.set(f, fs.readFileSync(f, 'utf8'))

const fileExports = new Map()
function addExp(f, n) { if (!fileExports.has(f)) fileExports.set(f, new Set()); fileExports.get(f).add(n) }
for (const f of srcFiles) {
  const src = contents.get(f); let m
  const declRe = /\bexport\s+(?:(async\s+)?function|const|let|class|abstract\s+class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
  while ((m = declRe.exec(src))) addExp(f, m[2])
  const namedRe = /\bexport\s*\{([^}]*)\}\s*(?:from\s+['"][^'"]+['"])?/g
  while ((m = namedRe.exec(src))) { for (const pair of m[1].split(',').map(s => s.trim()).filter(Boolean)) { const parts = pair.split(/\s+as\s+/); addExp(f, (parts[1] || parts[0]).trim()) } }
}

const rel = p => path.relative(ROOT, p).replace(/\\/g, '/')
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// external reference check (any other file, INCLUDING tests)
function externalFiles(sym, defFile) {
  const re = new RegExp('\\b' + escRe(sym) + '\\b')
  for (const f of files) { if (f === defFile) continue; if (re.test(contents.get(f))) return true }
  return false
}
function internalRefs(sym, defFile) {
  const src = contents.get(defFile)
  const stripped = src.replace(/\bexport\s+(?:async\s+)?(?:function|const|let|class|abstract\s+class|interface|type|enum)\s+/g, 'X ').replace(/\bexport\s*\{[^}]*\}/g, ' ')
  const re = new RegExp('\\b' + escRe(sym) + '\\b', 'g')
  return (stripped.match(re) || []).length
}

const unused = []
for (const [f, syms] of fileExports) {
  for (const s of syms) {
    if (s === 'default' || !/^[A-Za-z_$][\w$]*$/.test(s)) continue
    if (!externalFiles(s, f)) unused.push({ f: rel(f), s, internal: internalRefs(s, f) > 0 })
  }
}

const byFile = {}
for (const d of unused) (byFile[d.f] ||= []).push(d.s + (d.internal ? ' [internal-only:drop export]' : ' [dead:delete]'))
const byPkg = {}
for (const f of Object.keys(byFile).sort()) { const pkg = f.split('/').slice(0, 2).join('/'); (byPkg[pkg] ||= []).push({ f, syms: byFile[f] }) }
let total = unused.length, deadDel = unused.filter(d => !d.internal).length
console.log(`# unused exports: ${total} (delete ${deadDel}, drop-export ${total - deadDel}) across ${Object.keys(byFile).length} files`)
for (const pkg of Object.keys(byPkg).sort()) { console.log(`\n=== ${pkg} ===`); for (const { f, syms } of byPkg[pkg]) console.log(`${f}\n  ${syms.join(', ')}`) }
fs.writeFileSync(path.join(ROOT, '.dead-exports.json'), JSON.stringify(unused, null, 2))
console.log('\nWrote .dead-exports.json')
