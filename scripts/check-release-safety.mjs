#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'

const root = process.cwd()
const errors = []
const warnings = []

function fail(message) {
  errors.push(message)
}

function warn(message) {
  warnings.push(message)
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean)
const forbiddenExact = new Set([
  '.cf-deploy.env',
  '.cloudflare.env',
  'apps/worker/.dev.vars',
  'apps/worker/wrangler.prod-local.toml',
])
const forbiddenPrefixes = ['.playwright-mcp/', '.tmp-']

for (const file of tracked) {
  if (forbiddenExact.has(file) || forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
    fail(`tracked release-sensitive path: ${file}`)
  }
  if (file.endsWith('.log')) fail(`tracked log file: ${file}`)
}

for (const file of forbiddenExact) {
  if (existsSync(join(root, file))) fail(`release-sensitive path exists in the working tree: ${file}`)
}
for (const prefix of forbiddenPrefixes) {
  // R5-21: existsSync(joined path) tested the literal '.tmp-' entry which
  // never exists; scan the directory for real scratch files instead.
  const hits = existsSync(root)
    ? readdirSync(root).filter((name) => name.startsWith(prefix))
    : []
  if (hits.length > 0) fail(`release-sensitive path exists in the working tree: ${hits[0]} (and ${hits.length - 1} more)`)
}

for (const file of ['package.json', 'apps/tab/package.json', 'apps/web/package.json', 'apps/worker/package.json', 'packages/ai/package.json', 'packages/backend-core/package.json', 'packages/contracts/package.json', 'landing/package.json']) {
  try {
    const text = readFileSync(join(root, file), 'utf8')
    if (text.includes('github.com/your-org/')) fail(`placeholder repository URL in ${file}`)
  } catch {
    fail(`missing manifest: ${file}`)
  }
}

const remote = git(['remote'])
if (!remote) warn('no Git remote is configured; public release provenance cannot be verified')

const status = git(['status', '--porcelain'])
if (status) fail('working tree is not clean; build from a clean checkout')

const secretPatterns = [
  /BEGIN (?:RSA|EC|OPENSSH|DSA|ENCRYPTED|PRIVATE) KEY/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  // sk- must exclude sk-test-style fixtures but include the modern provider
  // prefixes (OpenAI sk-proj-, Anthropic sk-ant-, OpenRouter sk-or-) and
  // hyphenated long keys.
  /\bsk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
]
for (const file of tracked) {
  let text
  try {
    text = readFileSync(join(root, file), 'utf8')
  } catch {
    continue
  }
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    fail(`high-confidence secret signature in tracked file: ${file}`)
  }
}

if (warnings.length) {
  console.warn('Release safety warnings:')
  for (const warning of warnings) console.warn(`- ${warning}`)
}
if (errors.length) {
  console.error('Release safety check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}
console.log(`Release safety check passed: ${tracked.length} tracked files inspected.`)
