#!/usr/bin/env node
/**
 * apps/tab/scripts/zip-dist.mjs — 把扩展生产构建打成 Chrome Web Store 可上传的 zip。
 *
 * 用法:先 `pnpm --filter @tmarks/tab build`(产物在 apps/tab/dist),再
 * `node scripts/zip-dist.mjs [--out <path>]`。默认输出
 * apps/tab/release/tmarks-extension-<manifest version>.zip。
 *
 * - dist 内容按原相对路径打包,manifest.json 必须位于 zip 根(商店硬性要求),
 *   所以 zip 只能包含 dist 本身,不能把 dist 目录作为外层文件夹。
 * - source maps 不入包(vite 构建默认生成 .map,商店包不需要且体积翻倍)。
 * - 无第三方依赖:优先用系统 zip(Git Bash for Windows / macOS / Linux 均自带),
 *   否则回退 powershell Compress-Archive(Windows 原生)。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.resolve(__dirname, '../dist')
const releaseDir = path.resolve(__dirname, '../release')

function fail(message) {
  console.error(`[zip-dist] ${message}`)
  process.exit(1)
}

if (!fs.existsSync(path.join(distDir, 'manifest.json'))) {
  fail(`dist/manifest.json not found at ${distDir} — run \`pnpm --filter @tmarks/tab build\` first.`)
}
const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'))
const version = String(manifest.version || '')
if (!/^\d+\.\d+\.\d+/.test(version)) fail(`manifest.version "${version}" is not a release version`)

const outArgIdx = process.argv.indexOf('--out')
const zipPath = path.resolve(
  outArgIdx !== -1 && process.argv[outArgIdx + 1]
    ? process.argv[outArgIdx + 1]
    : path.join(releaseDir, `tmarks-extension-${version}.zip`)
)
fs.mkdirSync(path.dirname(zipPath), { recursive: true })
if (fs.existsSync(zipPath)) fs.rmSync(zipPath)

// Exclude source maps from the store package. Passing an exclude list through
// shell argv risks Windows quoting bugs; copy to a staging dir instead and zip
// that, so the exclude rule is enforced by the fs walk rather than by the
// archiver CLI.
const stagingDir = path.join(releaseDir, '.zip-staging')
fs.rmSync(stagingDir, { recursive: true, force: true })
fs.cpSync(distDir, stagingDir, {
  recursive: true,
  filter: (src) => !src.endsWith('.map'),
})

// The store package must carry the project license and notices alongside the
// compiled extension. A checkout-only copy of these files is not sufficient
// for the uploaded artifact.
const rootDir = path.resolve(__dirname, '../../..')
for (const legalFile of ['LICENSE', 'NOTICE.md']) {
  const source = path.join(rootDir, legalFile)
  if (!fs.existsSync(source)) fail(`${legalFile} not found at ${source}`)
  fs.copyFileSync(source, path.join(stagingDir, legalFile))
}

// Windows 路径给 PowerShell 用(纯反斜杠),PS 单引号串里的单引号按 '' 转义。
const winPath = zipPath.replaceAll('/', '\\')
const stagingWin = stagingDir.replaceAll('/', '\\')
const psQuote = (s) => s.replace(/'/g, "''")

try {
  // `-r <out> .` from inside the staging dir puts the CONTENTS at zip root
  // (manifest.json at root is a store requirement).
  execFileSync('zip', ['-r', '-q', zipPath, '.'], { cwd: stagingDir, stdio: 'inherit' })
} catch {
  // Windows without `zip` on PATH. Compress-Archive is NOT store-safe here:
  // it writes backslash entry separators (at least through PowerShell 5.1),
  // which the store rejects — so drive .NET ZipFile and normalize to '/'.
  execFileSync(
    'powershell',
    [
      '-NoProfile', '-Command',
      [
        "$ErrorActionPreference = 'Stop'",
        'Add-Type -AssemblyName System.IO.Compression',
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        `$src = '${psQuote(stagingWin)}'`,
        `$dst = '${psQuote(winPath)}'`,
        '$zip = [System.IO.Compression.ZipFile]::Open($dst, \'Create\')',
        'try {',
        '  Get-ChildItem -LiteralPath $src -Recurse -File | ForEach-Object {',
        "    $rel = $_.FullName.Substring($src.Length + 1).Replace('\\', '/')",
        '    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(',
        '      $zip, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal)',
        '  }',
        '} finally { $zip.Dispose() }',
      ].join('\n'),
    ],
    { stdio: 'inherit' }
  )
}

fs.rmSync(stagingDir, { recursive: true, force: true })

console.log(`[zip-dist] ${zipPath} (${(fs.statSync(zipPath).size / 1024).toFixed(0)} KiB)`)
