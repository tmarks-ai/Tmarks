import { describe, expect, it } from 'vitest'
import { createExportJsonStream } from '../src/lib/import-export/export-stream'
import { filterExportData } from '../src/lib/import-export/json-exporter'
import type { TMarksExportData } from '@tmarks/contracts'

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

const baseData: TMarksExportData = {
  version: '1.2.0',
  format: 'tmarks',
  exported_at: '2026-08-21T00:00:00.000Z',
  bookmarks: [
    {
      id: 'b1',
      title: 'Example',
      url: 'https://example.com',
      tags: [],
      is_pinned: false,
      created_at: '2026-08-21T00:00:00.000Z',
      updated_at: '2026-08-21T00:00:00.000Z',
    },
  ],
  bookmark_folders: [],
  tags: [],
  tab_groups: [],
  metadata: { total_bookmarks: 1, total_tags: 0, export_format: 'json', source: 'tmarks' },
}

function withoutMetadata(): TMarksExportData {
  return filterExportData(baseData, {
    include_tags: true,
    include_metadata: false,
    format_options: {},
  })
}

describe('export JSON stream', () => {
  it('parses and omits metadata when include_metadata=false (compact)', async () => {
    const text = await readAll(createExportJsonStream(withoutMetadata(), false))
    expect(text).not.toContain('undefined')
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed.version).toBe('1.2.0')
    expect(Array.isArray(parsed.bookmarks)).toBe(true)
    expect(parsed).not.toHaveProperty('metadata')
  })

  it('parses and omits metadata when include_metadata=false (pretty)', async () => {
    const text = await readAll(createExportJsonStream(withoutMetadata(), true))
    expect(text).not.toContain('undefined')
    expect(text).toContain('\n')
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed).not.toHaveProperty('metadata')
    expect(Array.isArray(parsed.tab_groups)).toBe(true)
  })

  it('keeps the metadata block when present', async () => {
    const text = await readAll(createExportJsonStream(baseData, false))
    const parsed = JSON.parse(text) as Record<string, unknown>
    expect(parsed.metadata).toMatchObject({ total_bookmarks: 1 })
  })
})