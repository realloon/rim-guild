import { Database, type SQLQueryBindings } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  findCommission,
  incrementCommissionViews,
} from '../src/lib/commissions'

class SQLitePreparedStatement {
  private parameters: SQLQueryBindings[] = []

  constructor(
    private readonly database: Database,
    private readonly sql: string,
  ) {}

  bind(...parameters: SQLQueryBindings[]) {
    this.parameters = parameters
    return this
  }

  async first<T>() {
    return this.database
      .query<T, SQLQueryBindings[]>(this.sql)
      .get(...this.parameters)
  }

  async all<T>() {
    return {
      results: this.database
        .query<T, SQLQueryBindings[]>(this.sql)
        .all(...this.parameters),
    }
  }

  async run() {
    const result = this.database.query(this.sql).run(...this.parameters)
    return {
      meta: {
        changes: result.changes,
        last_row_id: result.lastInsertRowid,
      },
    }
  }
}

class SQLiteD1 {
  constructor(private readonly database: Database) {}

  prepare(sql: string) {
    return new SQLitePreparedStatement(this.database, sql)
  }
}

// The lib functions only need the D1 operations the shim provides.
function createDb(database: Database) {
  return new SQLiteD1(database) as unknown as D1Database
}

const schema = await Bun.file(
  new URL('../db/schema.sql', import.meta.url),
).text()

const databases: Database[] = []

function createDatabase() {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys = ON')
  database.run(schema)
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
    const db = createDb(database)

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
    const db = createDb(database)

    const commissionId = addCommission(database)
    expect(
      await incrementCommissionViews(db, commissionId, 'owner'),
    ).toBeNull()
    expect(await incrementCommissionViews(db, commissionId, 'member')).toBe(1)
    expect((await findCommission(db, commissionId))!.view_count).toBe(1)
  })
})
