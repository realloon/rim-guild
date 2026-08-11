import type { ActionClient, ActionInputSchema } from 'astro:actions'
import type { z } from 'astro/zod'
import { Database, type SQLQueryBindings } from 'bun:sqlite'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  createDatabase as createTestDatabase,
  createD1,
  loadSchema,
} from './helpers/d1'

class TestActionError extends Error {
  constructor(readonly details: { code: string; message: string }) {
    super(details.message)
  }
}

mock.module('astro:actions', () => ({
  ActionError: TestActionError,
  defineAction: (config: { handler: (...args: unknown[]) => unknown }) =>
    config.handler,
}))

const environment: { rim_guild_db: D1Database | null } = {
  rim_guild_db: null,
}

mock.module('cloudflare:workers', () => ({ env: environment }))

const { server: actionServer } = await import('../src/actions/index')
const schema = await loadSchema()

const databases: Database[] = []

function createDatabase() {
  const database = createTestDatabase(schema)
  databases.push(database)

  environment.rim_guild_db = createD1(database)
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
      `INSERT INTO commissions (title, description, tags, author_token)
       VALUES ('测试委托', '测试描述', '', ?)`,
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

function addComment(
  database: Database,
  commissionId: number,
  profileToken: string,
  content = '测试评论',
) {
  const result = database
    .query(
      `INSERT INTO commission_comments (commission_id, profile_token, content)
       VALUES (?, ?, ?)`,
    )
    .run(commissionId, profileToken, content)
  return Number(result.lastInsertRowid)
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

function context(profileToken?: string) {
  return {
    locals: {
      auth: profileToken ? { profileToken } : undefined,
    },
  }
}

type TestActionContext = ReturnType<typeof context>
type ActionName = keyof typeof actionServer & string
type ActionClientFor<Name extends ActionName> = Extract<
  (typeof actionServer)[Name],
  ActionClient<any, any, any>
>
type ActionInput<Name extends ActionName> = z.infer<
  ActionInputSchema<ActionClientFor<Name>>
>
type ActionOutput<Name extends ActionName> = Awaited<
  ReturnType<ActionClientFor<Name>['orThrow']>
>
type TestAction<Name extends ActionName> = (
  input: ActionInput<Name>,
  actionContext: TestActionContext,
) => Promise<ActionOutput<Name>>
type TestServer = {
  [Name in ActionName]: TestAction<Name>
}

// The mock turns these Astro actions back into their server handlers for tests.
const server = actionServer as unknown as TestServer

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

    expect(
      await server.createCommission(
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
    ).toEqual({ id: 1 })

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

  test('claimRequirement treats count as informational and is idempotent', async () => {
    const database = createDatabase()
    addProfile(database, 'owner')
    addProfile(database, 'member-1')
    addProfile(database, 'member-2')
    addProfile(database, 'member-3')
    const commissionId = addCommission(database, { count: 2 })

    expect(
      await server.claimRequirement(
        { commissionId, requirementType: 'artist' },
        context('member-1'),
      ),
    ).toEqual({ ok: true, claimed: true, claimCount: 1 })
    expect(
      await server.claimRequirement(
        { commissionId, requirementType: 'artist' },
        context('member-1'),
      ),
    ).toEqual({ ok: true, claimed: true, claimCount: 1 })
    expect(
      await server.claimRequirement(
        { commissionId, requirementType: 'artist' },
        context('member-2'),
      ),
    ).toEqual({ ok: true, claimed: true, claimCount: 2 })

    expect(
      await server.claimRequirement(
        { commissionId, requirementType: 'artist' },
        context('member-3'),
      ),
    ).toEqual({ ok: true, claimed: true, claimCount: 3 })

    expect(
      database
        .query<{ count: number }, SQLQueryBindings[]>(
          'SELECT COUNT(*) AS count FROM claims',
        )
        .get()!.count,
    ).toBe(3)
  })

  test('claimRequirement rejects the owner and closed requirements', async () => {
    const database = createDatabase()
    addProfile(database, 'owner')
    addProfile(database, 'member')
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
    addProfile(database, 'owner')
    addProfile(database, 'member-1')
    addProfile(database, 'member-2')
    const commissionId = addCommission(database, { count: 2 })
    addClaim(database, commissionId, 'artist', 'member-1')
    addClaim(database, commissionId, 'artist', 'member-2')

    expect(
      await server.cancelClaim(
        { commissionId, requirementType: 'artist' },
        context('member-1'),
      ),
    ).toEqual({ ok: true, claimed: false, claimCount: 1 })
    expect(
      database
        .query<{ profile_token: string }, SQLQueryBindings[]>(
          'SELECT profile_token FROM claims ORDER BY profile_token',
        )
        .all(),
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
    addProfile(database, 'owner')
    addProfile(database, 'member')
    const commissionId = addCommission(database)

    await expectActionError(
      server.updateRequirementStatus(
        { commissionId, requirementType: 'artist', status: 'closed' },
        context('member'),
      ),
      'FORBIDDEN',
      '你无权执行此操作',
    )
    expect(
      await server.updateRequirementStatus(
        { commissionId, requirementType: 'artist', status: 'closed' },
        context('owner'),
      ),
    ).toEqual({ id: commissionId })
    expect(
      database
        .query<{ status: string }, SQLQueryBindings[]>(
          'SELECT status FROM requirements',
        )
        .get()!.status,
    ).toBe('closed')
  })

  test('updateCommission preserves claims when count changes', async () => {
    const database = createDatabase()
    addProfile(database, 'owner')
    addProfile(database, 'member')
    addProfile(database, 'member-2')
    const commissionId = addCommission(database, { count: 2 })
    addClaim(database, commissionId, 'artist', 'member')
    addClaim(database, commissionId, 'artist', 'member-2')

    expect(
      await server.updateCommission(
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
    ).toEqual({ id: commissionId })
    expect(
      database
        .query<{ count: number }, SQLQueryBindings[]>(
          'SELECT count FROM requirements',
        )
        .get()!.count,
    ).toBe(1)
    expect(
      database
        .query<{ count: number }, SQLQueryBindings[]>(
          'SELECT COUNT(*) AS count FROM claims',
        )
        .get()!.count,
    ).toBe(2)
  })

  test('updateCommission cascades claims for removed requirements', async () => {
    const database = createDatabase()
    addProfile(database)
    addProfile(database, 'member')
    const commissionId = addCommission(database)
    database
      .query(
        `INSERT INTO requirements
         (commission_id, requirement_type, description, count, status)
         VALUES (?, 'writer', '测试文案需求', 1, 'open')`,
      )
      .run(commissionId)
    addClaim(database, commissionId, 'artist', 'member')

    expect(
      await server.updateCommission(
        {
          commissionId,
          title: '更新后的测试委托',
          description: '',
          tags: [],
          requirementTypes: ['writer'],
          requirementDescriptions: ['保留文案需求'],
          requirementCounts: [1],
        },
        context('owner'),
      ),
    ).toEqual({ id: commissionId })

    expect(
      database
        .query(
          'SELECT requirement_type FROM requirements ORDER BY requirement_type',
        )
        .all(),
    ).toEqual([{ requirement_type: 'writer' }])
    expect(
      database
        .query<{ count: number }, SQLQueryBindings[]>(
          'SELECT COUNT(*) AS count FROM claims',
        )
        .get()!.count,
    ).toBe(0)
  })

  test('addCommissionComment requires login and stores the comment', async () => {
    const database = createDatabase()
    addProfile(database, 'owner')
    addProfile(database, 'member')
    const commissionId = addCommission(database)

    await expectActionError(
      server.addCommissionComment(
        { commissionId, content: '这条评论' },
        context(),
      ),
      'UNAUTHORIZED',
      '请先登录',
    )

    const comment = await server.addCommissionComment(
      { commissionId, content: '这条评论' },
      context('member'),
    )
    expect(comment).toEqual({
      id: 1,
      content: '这条评论',
      created_at: expect.any(String),
    })

    expect(
      database
        .query(
          `SELECT commission_id, profile_token, content
           FROM commission_comments`,
        )
        .all(),
    ).toEqual([
      {
        commission_id: commissionId,
        profile_token: 'member',
        content: '这条评论',
      },
    ])
  })

  test('deleteCommissionComment allows only the commenter or the publisher', async () => {
    const database = createDatabase()
    addProfile(database, 'owner')
    addProfile(database, 'member')
    addProfile(database, 'other')
    const commissionId = addCommission(database)
    const commentId = addComment(database, commissionId, 'member')

    await expectActionError(
      server.deleteCommissionComment({ commentId }, context('other')),
      'FORBIDDEN',
      '你无权执行此操作',
    )

    expect(
      await server.deleteCommissionComment({ commentId }, context('owner')),
    ).toEqual({ ok: true })

    const secondCommentId = addComment(database, commissionId, 'member')
    expect(
      await server.deleteCommissionComment(
        { commentId: secondCommentId },
        context('member'),
      ),
    ).toEqual({ ok: true })

    await expectActionError(
      server.deleteCommissionComment({ commentId }, context('member')),
      'FORBIDDEN',
      '你无权执行此操作',
    )
  })

  test('deleteCommission removes the commission and dependent records', async () => {
    const database = createDatabase()
    addProfile(database, 'owner')
    addProfile(database, 'member')
    const commissionId = addCommission(database)
    addClaim(database, commissionId, 'artist', 'member')
    database
      .query(
        `INSERT INTO commission_updates (commission_id, content)
         VALUES (?, '测试更新')`,
      )
      .run(commissionId)
    addComment(database, commissionId, 'member')

    expect(
      await server.deleteCommission({ commissionId }, context('owner')),
    ).toEqual({ ok: true })

    for (const table of [
      'commissions',
      'requirements',
      'claims',
      'commission_updates',
      'commission_comments',
    ]) {
      const count = database
        .query<{ count: number }, SQLQueryBindings[]>(
          `SELECT COUNT(*) AS count FROM ${table}`,
        )
        .get()!.count
      expect(count).toBe(0)
    }
  })
})
