export function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

export function idempotencyKey(userId: string, clientOperationId: string) {
  return `${userId}:${clientOperationId}`
}

export function entityRevisionKey(userId: string, entityType: string, entityId: string) {
  return `${userId}:${entityType}:${entityId}`
}

export function removeWhere<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      items.splice(index, 1)
    }
  }
}

export function pick<T extends Record<string, unknown>, K extends keyof T>(row: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, row[key]])) as Pick<T, K>
}
