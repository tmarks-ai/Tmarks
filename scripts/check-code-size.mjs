#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const maxLines = Number(readArg('--max-lines') || 300)
const fail = process.argv.includes('--fail')

// The line gate covers hand-written code under apps/, packages/ and scripts/.
// sql/ (repo root) is deliberately OUT of scope: schema files are numbered-domain
// DDL by design, and schema history is append-only, not code to be split. Landing
// is outside the pnpm workspace and is gated by its own convention (see
// landing/README.md).
const roots = ['apps', 'packages', 'scripts']
const extraFiles = ['turbo.json', 'tsconfig.base.json']
const extensions = new Set(['.ts', '.tsx', '.mjs', '.js', '.css', '.sql'])
// `wrangler types` 产物:含全量 workerd 运行时声明,按官方约定放包根并入库,
// 非手写代码,不参与 300 行门禁(改 wrangler.toml 后须重跑 `wrangler types`)。
const ignoredFiles = new Set(['worker-configuration.d.ts'])
const ignoredDirs = new Set([
    'node_modules', 'dist', '.turbo', '.wrangler', '.mf',
    'release', 'reports', 'build', 'coverage',
    'generated'
  ])

const files = roots
  .map((root) => path.join(repoRoot, root))
  .flatMap((root) => walk(root))
  .concat(extraFiles.map((file) => path.join(repoRoot, file)).filter(fs.existsSync))

const oversized = files
  .map((file) => ({ file, lines: countLines(file) }))
  .filter((entry) => entry.lines > maxLines)
  .sort((a, b) => b.lines - a.lines)

if (oversized.length > 0) {
  console.log(`Code size check: ${oversized.length} files exceed ${maxLines} lines.`)
  for (const entry of oversized) console.log(`${entry.lines}\t${path.relative(repoRoot, entry.file)}`)
  if (fail) process.exit(1)
} else {
  console.log(`Code size check passed: ${files.length} files are within ${maxLines} lines.`)
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(fullPath, files)
    else if (ignoredFiles.has(entry.name)) continue
    else if (extensions.has(path.extname(entry.name))) files.push(fullPath)
  }
  return files
}

function countLines(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).length
}

function readArg(name) {
  const prefix = `${name}=`
  const inline = process.argv.find((arg) => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}
