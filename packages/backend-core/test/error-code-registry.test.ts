import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * R8 CA-4/BR-4 防漂移闸:服务端可发出的每个错误码必须注册在
 * contracts 的 ApiErrorCode 联合里。OWNERSHIP_CONFLICT 曾以 `code: string`
 * 的松类型漏网——扩展端硬编码识别掩盖了缺口。类型层已收紧
 * (backend lib/types.ts),本闸兜住类型够不到的位置式调用
 * (reject(op, 'CODE', …) / forbidden(msg, 'CODE'))。
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACTS_ERRORS = join(ROOT, '..', 'contracts', 'src', 'errors.ts')
const BACKEND_SRC = join(ROOT, 'src')

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, name.name)
    if (name.isDirectory()) out.push(...listTsFiles(path))
    else if (name.name.endsWith('.ts')) out.push(path)
  }
  return out
}

function registeredCodes(): Set<string> {
  const source = readFileSync(CONTRACTS_ERRORS, 'utf8')
  const codes = new Set<string>()
  for (const match of source.matchAll(/'([A-Z][A-Z0-9_]+)'/g)) codes.add(match[1]!)
  return codes
}

function emittedCodes(): Set<string> {
  const codes = new Set<string>()
  const patterns = [
    /code\s*:\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /code\s*\?\?\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /\breject\(\s*[\w.]+\s*,\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
    /\bforbidden\(\s*['"`][^'"`]*['"`]\s*,\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  ]
  for (const file of listTsFiles(BACKEND_SRC)) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) codes.add(match[1]!)
    }
  }
  return codes
}

describe('error-code registry drift gate (R8 CA-4/BR-4)', () => {
  it('every code the backend can emit is registered in contracts ApiErrorCode', () => {
    const registered = registeredCodes()
    expect(registered.size).toBeGreaterThan(40) // the union parsed cleanly
    const emitted = emittedCodes()
    expect(emitted.size).toBeGreaterThan(10) // the emitters scanned non-trivially

    const unregistered = [...emitted].filter((code) => !registered.has(code))
    expect(unregistered, 'unregistered codes — add them to contracts/src/errors.ts').toEqual([])
  })

  it('the specific codes the audit found are present in both registry and emitters', () => {
    const registered = registeredCodes()
    const emitted = emittedCodes()
    for (const code of ['OWNERSHIP_CONFLICT', 'PAYLOAD_TOO_LARGE', 'RESOURCE_LOCKED', 'INVALID_PARENT_TREE']) {
      expect(registered.has(code), `${code} registered`).toBe(true)
    }
    expect(emitted.has('OWNERSHIP_CONFLICT')).toBe(true)
  })
})
