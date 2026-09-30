import { afterEach, describe, expect, it } from 'vitest'
import Dexie from 'dexie'
import { TMarkDB } from '../src/lib/db'
import { syncKey } from '../src/lib/db/queue'

const names: string[] = []

afterEach(async () => {
  await Promise.all(names.splice(0).map((name) => Dexie.delete(name)))
})

describe('sync queue identity', () => {
  it('uses entity type, entity id, and operation as the lookup key', () => {
    expect(syncKey('bookmark', 'same-id', 'upsert')).not.toBe(syncKey('tag', 'same-id', 'upsert'))
    expect(syncKey('bookmark', 'same-id', 'upsert')).not.toBe(syncKey('bookmark', 'same-id', 'delete'))
  })

  it('exposes the compound queue index while retaining the record id primary key', async () => {
    const name = `tmark-queue-${crypto.randomUUID()}`
    names.push(name)
    const db = new TMarkDB(name)
    await db.open()
    expect(db.syncQueue.schema.primKey.name).toBe('id')
    expect(db.syncQueue.schema.idxByName['[entity_type+entity_id+operation]']).toBeDefined()
    await db.close()
  })
})
