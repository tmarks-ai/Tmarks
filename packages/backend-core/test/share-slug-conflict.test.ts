import { describe, expect, it } from 'vitest'
import { PublicShareSettingsError, updatePublicShareSettings } from '../src/lib/share/public-share'
import { createSqliteD1, type SqliteD1Harness } from './helpers/sqlite-d1'

/**
 * R5-P3 regression (assertSlugAvailable TOCTOU): two concurrent updates that
 * pick the same slug both pass the SELECT precheck; the loser's write used to
 * surface as a raw 500 from the UNIQUE constraint. The typed 409 CONFLICT is
 * what the settings route already answers with.
 */
const USER = 'user-1'

function failingShareWrites(h: SqliteD1Harness): D1Database {
  return {
    prepare(sql: string) {
      if (sql.startsWith('INSERT INTO public_share_pages') || sql.startsWith('UPDATE public_share_pages')) {
        return {
          bind: () => ({
            async run() {
              throw new Error('UNIQUE constraint failed: public_share_pages.slug')
            },
          }),
        }
      }
      return (h.db as D1Database).prepare(sql)
    },
  } as unknown as D1Database
}

function otherErrorWrites(h: SqliteD1Harness): D1Database {
  return {
    prepare(sql: string) {
      if (sql.startsWith('INSERT INTO public_share_pages') || sql.startsWith('UPDATE public_share_pages')) {
        return {
          bind: () => ({
            async run() {
              throw new Error('D1 unavailable')
            },
          }),
        }
      }
      return (h.db as D1Database).prepare(sql)
    },
  } as unknown as D1Database
}

describe('public share slug UNIQUE race (R5-P3)', () => {
  it('maps a UNIQUE constraint failure to the typed 409 CONFLICT instead of a raw 500', async () => {
    const h = createSqliteD1(USER)
    const error = await updatePublicShareSettings(failingShareWrites(h), USER, { enabled: true }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PublicShareSettingsError)
    expect((error as PublicShareSettingsError).status).toBe(409)
    expect((error as PublicShareSettingsError).code).toBe('CONFLICT')
    expect((error as PublicShareSettingsError).message).toContain('already taken')
  })

  it('lets unrelated write failures propagate unchanged (no false conflict mapping)', async () => {
    const h = createSqliteD1(USER)
    const error = await updatePublicShareSettings(otherErrorWrites(h), USER, { enabled: true }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(PublicShareSettingsError)
    expect((error as Error).message).toBe('D1 unavailable')
  })
})
