import { uniqueStrings } from './folder-path'

const TAG_INPUT_SEPARATOR = /[,，、;；\n]+/

export function parseTagInput(value: string, limit = 8): string[] {
  return uniqueStrings(value.split(TAG_INPUT_SEPARATOR)).slice(0, limit)
}
