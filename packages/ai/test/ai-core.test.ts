import { describe, it, expect } from 'vitest'
import { parseAIResponse, normalizeFolderPart, normalizeFolderPath, splitFolderPath, parseTagInput, normalizeUrlKey } from '../src'

describe('parseAIResponse', () => {
  it('parses plain JSON object', () => {
    const content = '{"title":"Foo","tags":["a","b"],"classification":{"primary":"Tech","folderPath":["dev"]}}'
    const parsed = parseAIResponse(content)
    expect(parsed.title).toBe('Foo')
    expect(parsed.tags).toEqual(['a', 'b'])
    expect(parsed.classification?.folderPath).toEqual(['dev'])
  })

  it('clamps confidence into [0,1] and accepts percent 0-100', () => {
    expect(parseAIResponse('{"title":"A","confidence":0.8}').confidence).toBe(0.8)
    expect(parseAIResponse('{"title":"A","confidence":99}').confidence).toBe(0.99)
    expect(parseAIResponse('{"title":"A","confidence":5}').confidence).toBe(0.05)
    expect(parseAIResponse('{"title":"A","confidence":-2}').confidence).toBe(0)
    expect(parseAIResponse('{"title":"A","confidence":1.7}').confidence).toBe(0.017)
  })

  it('strips markdown fences', () => {
    const content = '```json\n{"title":"Bar","tags":["x"]}\n```'
    const parsed = parseAIResponse(content)
    expect(parsed.title).toBe('Bar')
    expect(parsed.tags).toEqual(['x'])
  })

  it('extracts balanced JSON from surrounding prose', () => {
    const content = 'Here is the result: {"title":"Baz","tags":["y"]} done.'
    const parsed = parseAIResponse(content)
    expect(parsed.title).toBe('Baz')
  })

  it('handles tag array of objects with name', () => {
    const content = '{"tags":[{"name":"a"},{"name":"b"}]}'
    const parsed = parseAIResponse(content)
    expect(parsed.tags).toEqual(['a', 'b'])
  })
})

describe('folder-path helpers', () => {
  it('normalizeFolderPart rejects placeholders', () => {
    expect(normalizeFolderPart('none')).toBeFalsy()
    expect(normalizeFolderPart('n/a')).toBeFalsy()
    expect(normalizeFolderPart('category')).toBeFalsy()
    expect(normalizeFolderPart('folder')).toBeFalsy()
    expect(normalizeFolderPart('Dev')).toBe('Dev')
  })

  it('normalizeFolderPath limits to 2 parts', () => {
    expect(normalizeFolderPath(['a', 'b', 'c'])).toHaveLength(2)
  })

  it('splitFolderPath handles / > | separators', () => {
    expect(splitFolderPath('a/b')).toEqual(['a', 'b'])
    expect(splitFolderPath('a > b')).toEqual(['a', 'b'])
    expect(splitFolderPath('a | b')).toEqual(['a', 'b'])
  })
})

describe('parseTagInput', () => {
  it('splits on multiple separators', () => {
    expect(parseTagInput('a,b，c、d;e\nf')).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('dedupes and limits', () => {
    expect(parseTagInput('a,a,a')).toEqual(['a'])
  })
})

describe('normalizeUrlKey', () => {
  it('lowercases protocol and host, strips hash and trailing slash', () => {
    expect(normalizeUrlKey('HTTPS://Example.com/Path/#frag')).toBe('https://example.com/Path')
  })
})
