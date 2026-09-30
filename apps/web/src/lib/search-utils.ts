/** 大小写不敏感包含。 */
export function fastIncludes(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase())
}
