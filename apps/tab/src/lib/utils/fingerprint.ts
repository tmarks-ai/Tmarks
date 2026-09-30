import type { EntityId } from '@tmarks/contracts'

/** 指纹用的条目切片(title+url;position 仅入参兼容,不参与指纹)。 */
interface FingerprintItem {
  position?: number
  title: string
  url: string
}

function normalizePart(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * 构造标签页组指纹:title::parentId::(title:url|...)。
 * 用于检测重复采集(同一组标签页已采集过则提示而非重复建组)。移植自旧 aitmarks。
 * 真正"顺序无关":按 url+title 归一排序后拼接,不含 position——position 会随
 * 组内删除/重排漂移(删除一项后 position 变 0,2,3…),带 position 的指纹会让
 * 同一标签页集合在删过一项后永远查不到重复。
 */
export function buildTabGroupFingerprint(input: {
  title?: string | null
  parentId?: EntityId | null
  items: FingerprintItem[]
}): string {
  const title = normalizePart(input.title)
  const parentId = normalizePart(input.parentId)
  const items = [...input.items]
    .sort((a, b) => {
      const url = normalizePart(a.url).localeCompare(normalizePart(b.url))
      return url !== 0 ? url : normalizePart(a.title).localeCompare(normalizePart(b.title))
    })
    .map((item) => `${normalizePart(item.title)}:${normalizePart(item.url)}`)
    .join('|')
  return `${title}::${parentId}::${items}`
}
