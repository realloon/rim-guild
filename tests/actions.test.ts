import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, mock, test } from 'bun:test'

class TestActionError extends Error {
  constructor(
    readonly details: { code: string; message: string },
  ) {
    super(details.message)
  }
}

mock.module('astro:actions', () => ({
  ActionError: TestActionError,
  defineAction: (config: { handler: (...args: unknown[]) => unknown }) =>
    config.handler,
}))

const environment: { rim_guild_db: SQLiteD1 | null } = {
  rim_guild_db: null,
}

mock.module('cloudflare:workers', () => ({ env: environment }))

const { server } = await import('../src/actions/index')
const schema = await Bun.file(
  new URL('../db/schema.sql', import.meta.url),
).text()

class SQLitePreparedStatement {
  private parameters: unknown[] = []

  constructor(
    private readonly database: Database,
    private readonly sql: string,
  ) {}

  bind(...parameters: unknown[]) {
    this.parameters = parameters
    return this
  }

  async first<T>() {
    return this.database.query(this.sql).get(...this.parameters) as T | null
  }

  async all<T>() {
    return {
      results: this.database.query(this.sql).all(...this.parameters) as T[],
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

// The handlers only need these D1 operations; SQLite keeps the tests in memory.
class SQLiteD1 {
  constructor(private readonly database: Database) {}

  prepare(sql: string) {
    return new SQLitePreparedStatement(this.database, sql)
  }

  async batch(statements: SQLitePreparedStatement[]) {
    this.database.run('BEGIN')
    try {
      const results = []
      for (const statement of statements) {
        results.push(await statement.run())
      }
      this.database.run('COMMIT')
      return results
    } catch (error) {
      this.database.run('ROLLBACK')
      throw error
    }
  }
}

const databases: Database[] = []

function createDatabase() {
  const database = new Database(':memory:')
  database.run('PRAGMA foreign_keys = ON')
  database.run(schema)
  databases.push(database)

  environment.rim_guild_db = new SQLiteD1(database)
  return database
}

function addCommission(
  database: Database,
  {
    authorToken = 'owner',
    requirementType = 'artist',
    count = 1,
    status = 'open',
  }: {
    authorToken?: string
    requirementType?: string
    count?: number
    status?: string
  } = {},
) {
  const result = database
    .query(
      `INSERT INTO commissions (title, author_token, author_id)
       VALUES ('测试委托', ?, 'author')`,
    )
    .run(authorToken)
  const commissionId = Number(result.lastInsertRowid)
  database
    .query(
      `INSERT INTO requirements
       (commission_id, requirement_type, description, count, status)
       VALUES (?, ?, '测试需求', ?, ?)`,
    )
    .run(commissionId, requirementType, count, status)
  return commissionId
}

function addClaim(
  database: Database,
  commissionId: number,
  requirementType: string,
  profileToken: string,
) {
  database
    .query(
      `INSERT INTO claims (commission_id, requirement_type, profile_token)
       VALUES (?, ?, ?)`,
    )
    .run(commissionId, requirementType, profileToken)
}

function addProfile(database: Database, profileToken = 'owner') {
  database
    .query(
      `INSERT INTO profiles (token, author_id, author_name, email)
       VALUES (?, 'author', '测试作者', 'owner@example.com')`,
    )
    .run(profileToken)
}

function context(profileToken?: string) {
  return {
    locals: {
      auth: profileToken ? { profileToken } : undefined,
    },
  }
}

async function expectActionError(
  action: Promise<unknown>,
  code: string,
  message: string,
) {
  try {
    await action
    throw new Error('action should have failed')
  } catch (error) {
    if (!(error instanceof TestActionError)) throw error
    expect(error.details).toEqual({ code, message })
  }
}

afterEach(() => {
  while (databases.length > 0) databases.pop()!.close()
})

describe('commission actions', () => {
  test('createCommission writes the commission and its requirements', async () => {
    const database = createDatabase()
    addProfile(database)

    await expect(
      server.createCommission(
        {
          title: '新的测试委托',
          description: '测试描述',
          tags: ['weapon'],
          requirementTypes: ['artist', 'writer'],
          requirementDescriptions: ['绘制素材', '润色文本'],
          requirementCounts: [2, 1],
        },
        context('owner'),
      ),
    ).resolves.toEqual({ id: 1 })

    expect(
      database
        .query(
          `SELECT requirement_type, count
           FROM requirements ORDER BY requirement_type`,
        )
        .all(),
    ).toEqual([
      { requirement_type: 'artist', count: 2 },
      { requirement_type: 'writer', count: 1 },
    ])
  })

  test('claimRequirement respects capacity and duplicate claims', async () => {
    const database = createDatabase()
    const commissionId = addCommission(database, { count: 2 })

    await expect(
      server.claimRequirement(
        { commissionId, requirementType: 'artist' },
        context('member-1'),
      ),
    ).resolves.toEqual({ ok: true })
    await expect(
      server.claimRequirement(
        { commissionId, requirementType: 'artist' },
        context('member-1'),
      ),
    ).resolves.toEqual({ ok: true })
    await expect(
      server.claimRequirement(
        { commissionId, requirementType: 'artist' },
        context('member-2'),
      ),
    ).resolves.toEqual({ ok: true })

    await expectActionError(
      server.claimRequirement(
        { commissionId, requirementType: 'artist' },
        context('member-3'),
      ),
      'BAD_REQUEST',
      '该需求已招满',
    )

    expect(
      database
        .query('SELECT COUNT(*) AS count FROM claims')
        .get<{ count: number }>()!.count,
    ).toBe(2)
  })

  test('claimRequirement rejects the owner and closed requirements', async () => {
    const database = createDatabase()
    const ownCommissionId = addCommission(database)
    const closedCommissionId = addCommission(database, { status: 'closed' })

    await expectActionError(
      server.claimRequirement(
        { commissionId: ownCommissionId, requirementType: 'artist' },
        context('owner'),
      ),
      'BAD_REQUEST',
      '不能认领自己发布的委托',
    )
    await expectActionError(
      server.claimRequirement(
        { commissionId: closedCommissionId, requirementType: 'artist' },
        context('member'),
      ),
      'BAD_REQUEST',
      '该需求已停止招募',
    )
  })

  test('cancelClaim removes only the current member claim', async () => {
    const database = createDatabase()
    const commissionId = addCommission(database, { count: 2 })
    addClaim(database, commissionId, 'artist', 'member-1')
    addClaim(database, commissionId, 'artist', 'member-2')

    await expect(
      server.cancelClaim(
        { commissionId, requirementType: 'artist' },
        context('member-1'),
      ),
    ).resolves.toEqual({ ok: true })
    expect(
      database
        .query('SELECT profile_token FROM claims ORDER BY profile_token')
        .all<{ profile_token: string }>(),
    ).toEqual([{ profile_token: 'member-2' }])

    await expectActionError(
      server.cancelClaim(
        { commissionId, requirementType: 'artist' },
        context('member-1'),
      ),
      'NOT_FOUND',
      '你还没有认领该需求',
    )
  })

  test('updateRequirementStatus requires the owner', async () => {
    const database = createDatabase()
    const commissionId = addCommission(database)

    await expectActionError(
      server.updateRequirementStatus(
        { commissionId, requirementType: 'artist', status: 'closed' },
        context('member'),
      ),
      'FORBIDDEN',
      '无权操作',
    )
    await expect(
      server.updateRequirementStatus(
        { commissionId, requirementType: 'artist', status: 'closed' },
        context('owner'),
      ),
    ).resolves.toEqual({ id: commissionId })
    expect(
      database
        .query('SELECT status FROM requirements')
        .get<{ status: string }>()!.status,
    ).toBe('closed')
  })

  test('updateCommission cannot reduce a claimed requirement', async () => {
    const database = createDatabase()
    const commissionId = addCommission(database, { count: 2 })
    addClaim(database, commissionId, 'artist', 'member')
    addClaim(database, commissionId, 'artist', 'member-2')

    await expectActionError(
      server.updateCommission(
        {
          commissionId,
          title: '更新后的委托',
          description: '',
          tags: [],
          requirementTypes: ['artist'],
          requirementDescriptions: ['更新需求'],
          requirementCounts: [1],
        },
        context('owner'),
      ),
      'BAD_REQUEST',
      '画师的需要人数不能少于已认领人数',
    )
  })

  test('deleteCommission removes the commission and dependent records', async () => {
    const database = createDatabase()
    const commissionId = addCommission(database)
    addClaim(database, commissionId, 'artist', 'member')
    database
      .query(
        `INSERT INTO commission_updates (commission_id, content)
         VALUES (?, '测试更新')`,
      )
      .run(commissionId)

    await expect(
      server.deleteCommission({ commissionId }, context('owner')),
    ).resolves.toEqual({ ok: true })

    for (const table of [
      'commissions',
      'requirements',
      'claims',
      'commission_updates',
    ]) {
      const count = database
        .query(`SELECT COUNT(*) AS count FROM ${table}`)
        .get<{ count: number }>()!.count
      expect(count).toBe(0)
    }
  })
})
