import type { TMarksExportData } from '@tmarks/contracts'

/**
 * Serialize export data into a ReadableStream, yielding one JSON entity at a
 * time. The data object is assembled by collectExportData; this module avoids
 * the second full copy that JSON.stringify(wholeObject) would create, keeping
 * peak memory near the data size instead of 2x (or more with escaping).
 */
export function createExportJsonStream(data: TMarksExportData, prettyPrint: boolean): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const chunks = encodeJsonChunks(data, prettyPrint)
  const iterator = chunks[Symbol.asyncIterator]()

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next()
      if (done) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(value))
    },
    cancel: async () => {
      await iterator.return?.(undefined)
    },
  })
}

async function* encodeJsonChunks(data: TMarksExportData, prettyPrint: boolean): AsyncGenerator<string> {
  const nl = prettyPrint ? '\n' : ''
  const pad = prettyPrint ? '  ' : ''
  const inner = prettyPrint ? `,\n${pad}` : ','

  yield `{${nl}${pad}"version":${JSON.stringify(data.version)},${nl}${pad}"format":"tmarks",${nl}${pad}"exported_at":${JSON.stringify(data.exported_at)},`
  yield `${nl}${pad}"bookmarks":[`
  yield* encodeArrayChunks(data.bookmarks ?? [], inner)
  yield `],${nl}${pad}"bookmark_folders":[`
  yield* encodeArrayChunks(data.bookmark_folders ?? [], inner)
  yield `],${nl}${pad}"tags":[`
  yield* encodeArrayChunks(data.tags ?? [], inner)
  yield `],${nl}${pad}"tab_groups":[`
  yield* encodeArrayChunks(data.tab_groups ?? [], inner)
  // filterExportData deletes `metadata` when include_metadata=false; stringifying
  // undefined here would emit the literal token `undefined` and corrupt the JSON.
  // Skip the key (and its preceding comma) when absent so the output stays valid.
  if (data.metadata == null) {
    yield `]${nl}}`
  } else {
    yield `],${nl}${pad}"metadata":${JSON.stringify(data.metadata)}${nl}}`
  }
}

async function* encodeArrayChunks(items: unknown[], separator: string): AsyncGenerator<string> {
  for (let i = 0; i < items.length; i += 1) {
    if (i > 0) yield separator
    yield JSON.stringify(items[i])
  }
}