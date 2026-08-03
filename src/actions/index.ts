import { defineAction, ActionError } from 'astro:actions'
import type { ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'
import { env } from 'cloudflare:workers'
import {
  COMMISSION_TAGS,
  CREATOR_TYPES,
  REQUIREMENT_TYPES,
} from '../lib/commissions'
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  generateSalt,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from '../lib/auth'

const requirementTypes = Object.keys(REQUIREMENT_TYPES) as [string, ...string[]]
const commissionTags = Object.keys(COMMISSION_TAGS) as [string, ...string[]]
const creatorTypes = Object.keys(CREATOR_TYPES) as [string, ...string[]]

const emailSchema = z.preprocess(
  v => (v == null ? '' : String(v).trim().toLowerCase()),
  z
    .string()
    .max(200)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '请输入有效的邮箱地址'),
)

const commissionInput = {
  title: z.preprocess(
    v => (v == null ? '' : String(v).trim()),
    z.string().min(2, '标题至少 2 个字').max(80, '标题最多 80 个字'),
  ),
  description: z.preprocess(
    v => (v == null ? '' : String(v).trim()),
    z.string().max(5000, '描述最多 5000 个字'),
  ),
  tags: z.array(z.enum(commissionTags)).default([]),
  requirementTypes: z.array(z.enum(requirementTypes)),
  requirementDescriptions: z.array(
    z.preprocess(
      v => (v == null ? '' : String(v).trim()),
      z.string().min(1, '每项需求请填写具体要求'),
    ),
  ),
  requirementCounts: z.array(
    z.preprocess(
      v => (v == null ? 1 : Number(v)),
      z.number().int().min(1).max(99),
    ),
  ),
}

function validateRequirements(
  requirementTypes: string[],
  requirementDescriptions: string[],
  requirementCounts: number[],
) {
  if (requirementTypes.length === 0) {
    throw new ActionError({
      code: 'BAD_REQUEST',
      message: '请至少添加一项需求',
    })
  }
  if (
    requirementTypes.length !== requirementDescriptions.length ||
    requirementTypes.length !== requirementCounts.length
  ) {
    throw new ActionError({
      code: 'BAD_REQUEST',
      message: '需求类型、要求与人数不匹配',
    })
  }
  if (new Set(requirementTypes).size !== requirementTypes.length) {
    throw new ActionError({
      code: 'BAD_REQUEST',
      message: '同一种需求类型只能添加一次',
    })
  }
}

/** 当前登录用户 profile token；未登录抛错 */
function requireAuth(context: ActionAPIContext) {
  const profileToken = context.locals.auth?.profileToken
  if (!profileToken) {
    throw new ActionError({ code: 'UNAUTHORIZED', message: '请先登录' })
  }
  return profileToken
}

async function assertOwner(commissionId: number, context: ActionAPIContext) {
  const profileToken = context.locals.auth?.profileToken
  if (!profileToken) {
    throw new ActionError({ code: 'FORBIDDEN', message: '无权操作' })
  }
  const db = env.rim_guild_db
  const commission = await db
    .prepare('SELECT author_token FROM commissions WHERE id = ?')
    .bind(commissionId)
    .first<{ author_token: string }>()
  if (!commission || commission.author_token !== profileToken) {
    throw new ActionError({ code: 'FORBIDDEN', message: '无权操作' })
  }
}

export const server = {
  createCommission: defineAction({
    accept: 'form',
    input: z.object(commissionInput),
    handler: async (input, context) => {
      validateRequirements(
        input.requirementTypes,
        input.requirementDescriptions,
        input.requirementCounts,
      )

      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const profile = await db
        .prepare('SELECT author_id, author_name FROM profiles WHERE token = ?')
        .bind(profileToken)
        .first<{ author_id: string; author_name: string }>()

      if (!profile) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '请先完善个人资料',
        })
      }

      const result = await db
        .prepare(
          'INSERT INTO commissions (title, description, tags, author_name, author_token, author_id) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          input.title,
          input.description || '',
          input.tags.join(','),
          profile.author_name,
          profileToken,
          profile.author_id,
        )
        .run()

      const commissionId = Number(result.meta.last_row_id)

      await db.batch(
        input.requirementTypes.map((requirementType, i) =>
          db
            .prepare(
              'INSERT INTO requirements (commission_id, requirement_type, description, count) VALUES (?, ?, ?, ?)',
            )
            .bind(
              commissionId,
              requirementType,
              input.requirementDescriptions[i],
              input.requirementCounts[i],
            ),
        ),
      )

      return { id: commissionId }
    },
  }),
  updateCommission: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      ...commissionInput,
    }),
    handler: async (input, context) => {
      validateRequirements(
        input.requirementTypes,
        input.requirementDescriptions,
        input.requirementCounts,
      )
      await assertOwner(input.commissionId, context)

      const db = env.rim_guild_db
      const existingRoles = await db
        .prepare('SELECT requirement_type, status FROM requirements WHERE commission_id = ?')
        .bind(input.commissionId)
        .all<{ requirement_type: string; status: string }>()
      const existingStatus = new Map(
        existingRoles.results.map(r => [r.requirement_type, r.status]),
      )
      const deletedRoles = existingRoles.results.filter(
        r =>
          !input.requirementTypes.includes(
            r.requirement_type as (typeof requirementTypes)[number],
          ),
      )

      await db.batch([
        db
          .prepare(
            'UPDATE commissions SET title = ?, description = ?, tags = ? WHERE id = ?',
          )
          .bind(
            input.title,
            input.description || '',
            input.tags.join(','),
            input.commissionId,
        ),
        ...input.requirementTypes.map((requirementType, i) =>
          db
            .prepare(
              `INSERT INTO requirements (commission_id, requirement_type, description, count, status) VALUES (?, ?, ?, ?, ?)
							ON CONFLICT (commission_id, requirement_type) DO UPDATE SET description = excluded.description, count = excluded.count`,
            )
            .bind(
              input.commissionId,
              requirementType,
              input.requirementDescriptions[i],
              input.requirementCounts[i],
              existingStatus.get(requirementType) ?? 'open',
            ),
        ),
        ...deletedRoles.map(r =>
          db
            .prepare(
              'DELETE FROM requirements WHERE commission_id = ? AND requirement_type = ?',
            )
            .bind(input.commissionId, r.requirement_type),
        ),
      ])

      return { id: input.commissionId }
    },
  }),
  updateRequirementStatus: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      requirementType: z.enum(requirementTypes),
      status: z.enum(['open', 'closed']),
    }),
    handler: async (input, context) => {
      await assertOwner(input.commissionId, context)

      const db = env.rim_guild_db
      await db
        .prepare(
          'UPDATE requirements SET status = ? WHERE commission_id = ? AND requirement_type = ?',
        )
        .bind(input.status, input.commissionId, input.requirementType)
        .run()

      return { id: input.commissionId }
    },
  }),
  deleteCommission: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
    }),
    handler: async (input, context) => {
      await assertOwner(input.commissionId, context)

      const db = env.rim_guild_db
      await db.batch([
        db
          .prepare('DELETE FROM requirements WHERE commission_id = ?')
          .bind(input.commissionId),
        db.prepare('DELETE FROM commissions WHERE id = ?').bind(input.commissionId),
      ])

      return { ok: true }
    },
  }),
  updateProfile: defineAction({
    accept: 'form',
    input: z.object({
      authorName: z.preprocess(
        v => (v == null ? '' : String(v).trim()),
        z.string().min(1, '请填写你的昵称').max(30, '昵称最多 30 个字'),
      ),
      qq: z.preprocess(
        v => (v == null ? '' : String(v).trim()),
        z.string().max(50),
      ),
      github: z.preprocess(
        v => (v == null ? '' : String(v).trim()),
        z.string().max(100),
      ),
      steam: z.preprocess(
        v => (v == null ? '' : String(v).trim()),
        z.string().max(100),
      ),
      creatorTypes: z.array(z.enum(creatorTypes)).default([]),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const creatorTypes = input.creatorTypes.join(',')
      await db
        .prepare(
          'UPDATE profiles SET author_name = ?, qq = ?, github = ?, steam = ?, creator_types = ? WHERE token = ?',
        )
        .bind(
          input.authorName,
          input.qq,
          input.github,
          input.steam,
          creatorTypes,
          profileToken,
        )
        .run()
      await db
        .prepare('UPDATE commissions SET author_name = ? WHERE author_token = ?')
        .bind(input.authorName, profileToken)
        .run()

      return { ok: true }
    },
  }),
  register: defineAction({
    accept: 'form',
    input: z.object({
      email: emailSchema,
      password: z.string().min(8, '密码至少 8 位'),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db

      const emailProfile = await db
        .prepare('SELECT token FROM profiles WHERE email = ?')
        .bind(input.email)
        .first<{ token: string }>()
      if (emailProfile) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '该邮箱已注册，请直接登录',
        })
      }

      const salt = generateSalt()
      const hash = await hashPassword(input.password, salt)
      const defaultName = input.email.split('@')[0]

      // 新建账号（新 session 绑定）
      const profileToken = crypto.randomUUID()
      const authorId = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
      await db
        .prepare(
          'INSERT INTO profiles (token, author_id, author_name, email, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(profileToken, authorId, defaultName, input.email, hash, salt)
        .run()
      const sessionToken = await createSession(db, profileToken)
      setSessionCookie(context, sessionToken)

      return { ok: true }
    },
  }),
  login: defineAction({
    accept: 'form',
    input: z.object({
      email: emailSchema,
      password: z.string().min(1, '请输入密码'),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profile = await db
        .prepare(
          'SELECT token, password_hash, password_salt FROM profiles WHERE email = ?',
        )
        .bind(input.email)
        .first<{
          token: string
          password_hash: string
          password_salt: string
        }>()

      if (!profile || !profile.password_hash) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '邮箱或密码不正确',
        })
      }
      const valid = await verifyPassword(
        input.password,
        profile.password_salt,
        profile.password_hash,
      )
      if (!valid) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '邮箱或密码不正确',
        })
      }

      const sessionToken = await createSession(db, profile.token)
      setSessionCookie(context, sessionToken)

      return { ok: true }
    },
  }),
  logout: defineAction({
    accept: 'form',
    handler: async (_input, context) => {
      const currentAuth = context.locals.auth
      if (currentAuth) {
        await deleteSession(env.rim_guild_db, currentAuth.sessionToken)
      }
      clearSessionCookie(context)
      return { ok: true }
    },
  }),
  claimRequirement: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      requirementType: z.enum(requirementTypes),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const commission = await db
        .prepare('SELECT author_token FROM commissions WHERE id = ?')
        .bind(input.commissionId)
        .first<{ author_token: string }>()
      if (!commission) {
        throw new ActionError({ code: 'NOT_FOUND', message: '该委托不存在' })
      }
      if (commission.author_token === profileToken) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '不能认领自己发布的委托',
        })
      }

      await db
        .prepare(
          'INSERT OR IGNORE INTO claims (commission_id, requirement_type, profile_token) VALUES (?, ?, ?)',
        )
        .bind(input.commissionId, input.requirementType, profileToken)
        .run()

      return { ok: true }
    },
  }),
  cancelClaim: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      requirementType: z.enum(requirementTypes),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      await db
        .prepare(
          'DELETE FROM claims WHERE commission_id = ? AND requirement_type = ? AND profile_token = ?',
        )
        .bind(input.commissionId, input.requirementType, profileToken)
        .run()

      return { ok: true }
    },
  }),
  addCommissionUpdate: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      content: z.preprocess(
        v => (v == null ? '' : String(v).trim()),
        z.string().min(1, '请输入更新内容').max(1000, '更新内容最多 1000 个字'),
      ),
    }),
    handler: async (input, context) => {
      await assertOwner(input.commissionId, context)

      const db = env.rim_guild_db
      await db
        .prepare('INSERT INTO commission_updates (commission_id, content) VALUES (?, ?)')
        .bind(input.commissionId, input.content)
        .run()

      return { ok: true }
    },
  }),
}
