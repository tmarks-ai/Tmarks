import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'

/**
 * R2-compatible adapter backed by the local filesystem.
 *
 * Key → file path mapping is 1:1 (R2 keys are safe path segments in this
 * app: `snapshots/<user>/<bm>/<uuid>.html`, `assets/<kind>/<sha256>`).
 * Content-type is stored in a `.meta.json` sidecar file.
 *
 * Implements the subset backend-core actually uses: put, get, delete.
 * (head and list are included for completeness but not exercised.)
 */
export class FilesystemR2 {
  private readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = rootDir
    if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true })
  }

  private pathFor(key: string): string {
    if (key.includes('..')) throw new Error(`R2 key path traversal rejected: ${key.slice(0, 60)}`)
    return join(this.rootDir, key)
  }

  private metaPathFor(key: string): string {
    return this.pathFor(key) + '.meta.json'
  }

  async put(key: string, value: Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<void> {
    const filePath = this.pathFor(key)
    mkdirSync(dirname(filePath), { recursive: true })

    const data = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
    writeFileSync(filePath, data)

    if (options?.httpMetadata?.contentType) {
      writeFileSync(this.metaPathFor(key), JSON.stringify({ contentType: options.httpMetadata.contentType }))
    }
  }

  async get(key: string): Promise<{ body: ReadableStream<Uint8Array>; httpMetadata: { contentType?: string } } | null> {
    const filePath = this.pathFor(key)
    if (!existsSync(filePath)) return null

    const data = readFileSync(filePath)
    let contentType: string | undefined
    const metaPath = this.metaPathFor(key)
    if (existsSync(metaPath)) {
      contentType = (JSON.parse(readFileSync(metaPath, 'utf8')) as { contentType?: string }).contentType
    }

    // Create a ReadableStream from the buffer (compatible with Response(body))
    const buffer = new Uint8Array(data)
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(buffer)
        controller.close()
      },
    })

    return { body: stream, httpMetadata: { contentType } }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.pathFor(key)
    const metaPath = this.metaPathFor(key)
    if (existsSync(filePath)) unlinkSync(filePath)
    if (existsSync(metaPath)) unlinkSync(metaPath)
  }

  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    const filePath = this.pathFor(key)
    if (!existsSync(filePath)) return null
    const stat = statSync(filePath)
    let contentType: string | undefined
    const metaPath = this.metaPathFor(key)
    if (existsSync(metaPath)) {
      contentType = (JSON.parse(readFileSync(metaPath, 'utf8')) as { contentType?: string }).contentType
    }
    return { size: stat.size, contentType }
  }
}
