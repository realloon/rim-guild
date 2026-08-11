import { afterEach, describe, expect, test } from 'bun:test'
import { type Database } from 'bun:sqlite'
import {
  findCommission,
  incrementCommissionViews,
} from '../src/lib/commissions'
import {
  createDatabase as createTestDatabase,
  createD1,
  loadSchema,
} from './helpers/d1'

const schema = await loadSchema()

const databases: Database[] = []

function createDatabase() {
  const database = createTestDatabase(schema)
  databases.push(database)
  return database
}

function addProfile(database: Database, profileToken = 'owner') {
  const passwordHash = '0'.repeat(64)
  const passwordSalt = '0'.repeat(32)
  database
    .query(
      `INSERT INTO profiles
       (token, author_id, author_name, qq, github, steam, creator_types,
        email, password_hash, password_salt)
       VALUES (?, ?, '测试作者', '', '', '', '', ?, ?, ?)`,
    )
    .run(
      profileToken,
      `author-${profileToken}`,
      `${profileToken}@example.com`,
      passwordHash,
      passwordSalt,
    )
}

function addCommission(database: Database, authorToken = 'owner') {
  const result = database
    .query(
      `INSERT INTO commissions (title, description, tags, author_token)
       VALUES ('测试委托', '测试描述', '', ?)`,
    )
    .run(authorToken)
  return Number(result.lastInsertRowid)
}

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close()
})

describe('commission view counts', () => {
  test('starts at zero and accumulates on each view', async () => {
    const database = createDatabase()
    addProfile(database)
    const db = createD1(database)

    const commissionId = addCommission(database)
    expect((await findCommission(db, commissionId))!.view_count).toBe(0)

    expect(await incrementCommissionViews(db, commissionId, null)).toBe(1)
    expect(await incrementCommissionViews(db, commissionId, null)).toBe(2)
    expect((await findCommission(db, commissionId))!.view_count).toBe(2)
  })

  test('excludes the author from counting', async () => {
    const database = createDatabase()
    addProfile(database, 'owner')
    addProfile(database, 'member')
    const db = createD1(database)

    const commissionId = addCommission(database)
    expect(await incrementCommissionViews(db, commissionId, 'owner')).toBeNull()
    expect(await incrementCommissionViews(db, commissionId, 'member')).toBe(1)
    expect((await findCommission(db, commissionId))!.view_count).toBe(1)
  })
})
