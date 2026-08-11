import { defineAction, ActionError } from 'astro:actions'
import type { ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'
import { env } from 'cloudflare:workers'
import {
  COMMISSION_TAG_KEYS,
  REQUIREMENT_TYPE_KEYS,
  REQUIREMENT_STATUS_KEYS,
  parseRequirementStatus,
  parseRequirementType,
} from '../lib/commissions'
import {
  requirementInputError,
  type RequirementFields,
  type RequirementInput,
} from '../lib/requirements'
import { accountActions } from './account'
import { formText, requireAuth } from './helpers'

const commissionSchema = z.object({
  title: z.preprocess(
    formText,
    z.string().min(2, '标题至少 2 个字').max(80, '标题最多 80 个字'),
  ),
  description: z.preprocess(
    formText,
    z.string().max(5000, '描述最多 5000 个字'),
  ),
  tags: z.array(z.enum(COMMISSION_TAG_KEYS)).default([]),
  requirementTypes: z.array(z.enum(REQUIREMENT_TYPE_KEYS)),
  requirementDescriptions: z.array(
    z.preprocess(formText, z.string().min(1, '每项需求请填写具体要求')),
  ),
  requirementCounts: z.array(
    z.preprocess(v => Number(v), z.number().int().min(1).max(99)),
  ),
})

function parseRequirementInputs(fields: RequirementFields): RequirementInput[] {
  const error = requirementInputError(fields)
  if (error) {
    throw new ActionError({ code: 'BAD_REQUEST', message: error })
  }

  return fields.requirementTypes.map((type, index) => ({
    type,
    description: fields.requirementDescriptions[index],
    count: fields.requirementCounts[index],
  }))
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

  return profileToken
}

async function getRequirementClaimState(
  db: D1Database,
  commissionId: number,
  requirementType: (typeof REQUIREMENT_TYPE_KEYS)[number],
  profileToken: string,
) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS claim_count,
              EXISTS (
                SELECT 1
                FROM claims own_claim
                WHERE own_claim.commission_id = ?
                  AND own_claim.requirement_type = ?
                  AND own_claim.profile_token = ?
              ) AS claimed
       FROM claims
       WHERE commission_id = ? AND requirement_type = ?`,
    )
    .bind(
      commissionId,
      requirementType,
      profileToken,
      commissionId,
      requirementType,
    )
    .first<{ claim_count: number; claimed: number }>()

  if (!row) {
    throw new Error('读取需求认领状态时数据库未返回结果')
  }

  return {
    ok: true as const,
    claimed: row.claimed === 1,
    claimCount: row.claim_count,
  }
}

export const server = {
  ...accountActions,
  createCommission: defineAction({
    accept: 'form',
    input: commissionSchema,
    handler: async (input, context) => {
      const requirements = parseRequirementInputs(input)

      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const profile = await db
        .prepare('SELECT token FROM profiles WHERE token = ?')
        .bind(profileToken)
        .first<{ token: string }>()

      if (!profile) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '请先完善个人资料',
        })
      }

      const requirementValues = requirements
        .map(() => '(last_insert_rowid(), ?, ?, ?, ?)')
        .join(', ')
      const [commissionResult] = await db.batch([
        db
          .prepare(
            'INSERT INTO commissions (title, description, tags, author_token) VALUES (?, ?, ?, ?)',
          )
          .bind(
            input.title,
            input.description,
            input.tags.join(','),
            profileToken,
          ),
        db
          .prepare(
            `INSERT INTO requirements (commission_id, requirement_type, description, count, status) VALUES ${requirementValues}`,
          )
          .bind(
            ...requirements.flatMap(({ type, description, count }) => [
              type,
              description,
              count,
              'open',
            ]),
          ),
      ])

      const commissionId = Number(commissionResult.meta.last_row_id)

      return { id: commissionId }
    },
  }),
  updateCommission: defineAction({
    accept: 'form',
    input: commissionSchema.extend({ commissionId: z.number() }),
    handler: async (input, context) => {
      const requirements = parseRequirementInputs(input)
      await assertOwner(input.commissionId, context)

      const db = env.rim_guild_db
      const existingRequirementRows = await db
        .prepare(
          'SELECT requirement_type, status FROM requirements WHERE commission_id = ?',
        )
        .bind(input.commissionId)
        .all<{
          requirement_type: string
          status: string
        }>()
      const existingRequirements = existingRequirementRows.results.map(row => ({
        type: parseRequirementType(row.requirement_type),
        status: parseRequirementStatus(row.status),
      }))
      const existingRequirementsByType = new Map(
        existingRequirements.map(requirement => [
          requirement.type,
          requirement,
        ]),
      )
      const requestedTypes = new Set(
        requirements.map(requirement => requirement.type),
      )
      const removedRequirements = existingRequirements.filter(
        requirement => !requestedTypes.has(requirement.type),
      )

      const [commissionResult] = await db.batch([
        db
          .prepare(
            'UPDATE commissions SET title = ?, description = ?, tags = ? WHERE id = ?',
          )
          .bind(
            input.title,
            input.description,
            input.tags.join(','),
            input.commissionId,
          ),
        ...requirements.map(requirement =>
          db
            .prepare(
              `INSERT INTO requirements (commission_id, requirement_type, description, count, status) VALUES (?, ?, ?, ?, ?)
							ON CONFLICT (commission_id, requirement_type) DO UPDATE SET description = excluded.description, count = excluded.count`,
            )
            .bind(
              input.commissionId,
              requirement.type,
              requirement.description,
              requirement.count,
              existingRequirementsByType.get(requirement.type)?.status ??
                'open',
            ),
        ),
        ...removedRequirements.map(requirement =>
          db
            .prepare(
              'DELETE FROM requirements WHERE commission_id = ? AND requirement_type = ?',
            )
            .bind(input.commissionId, requirement.type),
        ),
      ])

      if (commissionResult.meta.changes !== 1) {
        throw new ActionError({ code: 'NOT_FOUND', message: '该委托不存在' })
      }

      return { id: input.commissionId }
    },
  }),
  updateRequirementStatus: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      requirementType: z.enum(REQUIREMENT_TYPE_KEYS),
      status: z.enum(REQUIREMENT_STATUS_KEYS),
    }),
    handler: async (input, context) => {
      await assertOwner(input.commissionId, context)

      const db = env.rim_guild_db
      const result = await db
        .prepare(
          'UPDATE requirements SET status = ? WHERE commission_id = ? AND requirement_type = ?',
        )
        .bind(input.status, input.commissionId, input.requirementType)
        .run()
      if (result.meta.changes !== 1) {
        throw new ActionError({ code: 'NOT_FOUND', message: '该需求不存在' })
      }

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
      const result = await db
        .prepare('DELETE FROM commissions WHERE id = ?')
        .bind(input.commissionId)
        .run()
      if (result.meta.changes < 1) {
        throw new ActionError({ code: 'NOT_FOUND', message: '该委托不存在' })
      }

      return { ok: true }
    },
  }),
  claimRequirement: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      requirementType: z.enum(REQUIREMENT_TYPE_KEYS),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const requirement = await db
        .prepare(
          `SELECT c.author_token, r.status
           FROM commissions c
           JOIN requirements r
             ON r.commission_id = c.id
            AND r.requirement_type = ?
           WHERE c.id = ?`,
        )
        .bind(input.requirementType, input.commissionId)
        .first<{
          author_token: string
          status: string
        }>()
      if (!requirement) {
        throw new ActionError({ code: 'NOT_FOUND', message: '该需求不存在' })
      }
      if (requirement.author_token === profileToken) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '不能认领自己发布的委托',
        })
      }
      if (parseRequirementStatus(requirement.status) !== 'open') {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '该需求已停止招募',
        })
      }
      const result = await db
        .prepare(
          `INSERT INTO claims (commission_id, requirement_type, profile_token)
           SELECT ?, ?, ?
           FROM requirements r
           WHERE r.commission_id = ?
             AND r.requirement_type = ?
             AND r.status = 'open'
           ON CONFLICT (commission_id, requirement_type, profile_token) DO NOTHING`,
        )
        .bind(
          input.commissionId,
          input.requirementType,
          profileToken,
          input.commissionId,
          input.requirementType,
        )
        .run()

      if (result.meta.changes !== 1) {
        const currentRequirement = await db
          .prepare(
            `SELECT r.status,
                    EXISTS (
                      SELECT 1 FROM claims own_claim
                      WHERE own_claim.commission_id = r.commission_id
                        AND own_claim.requirement_type = r.requirement_type
                        AND own_claim.profile_token = ?
                    ) AS already_claimed
             FROM requirements r
             WHERE r.commission_id = ?
               AND r.requirement_type = ?`,
          )
          .bind(profileToken, input.commissionId, input.requirementType)
          .first<{
            status: string
            already_claimed: number
          }>()
        if (!currentRequirement) {
          throw new ActionError({ code: 'NOT_FOUND', message: '该需求不存在' })
        }
        if (currentRequirement.already_claimed) {
          return getRequirementClaimState(
            db,
            input.commissionId,
            input.requirementType,
            profileToken,
          )
        }
        if (parseRequirementStatus(currentRequirement.status) !== 'open') {
          throw new ActionError({
            code: 'BAD_REQUEST',
            message: '该需求已停止招募',
          })
        }
        throw new Error('认领需求时数据库状态发生变化')
      }

      return getRequirementClaimState(
        db,
        input.commissionId,
        input.requirementType,
        profileToken,
      )
    },
  }),
  cancelClaim: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      requirementType: z.enum(REQUIREMENT_TYPE_KEYS),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const result = await db
        .prepare(
          'DELETE FROM claims WHERE commission_id = ? AND requirement_type = ? AND profile_token = ?',
        )
        .bind(input.commissionId, input.requirementType, profileToken)
        .run()
      if (result.meta.changes !== 1) {
        throw new ActionError({
          code: 'NOT_FOUND',
          message: '你还没有认领该需求',
        })
      }

      return getRequirementClaimState(
        db,
        input.commissionId,
        input.requirementType,
        profileToken,
      )
    },
  }),
  addCommissionUpdate: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      content: z.preprocess(
        formText,
        z.string().min(1, '请输入更新内容').max(1000, '更新内容最多 1000 个字'),
      ),
    }),
    handler: async (input, context) => {
      await assertOwner(input.commissionId, context)

      const db = env.rim_guild_db
      await db
        .prepare(
          'INSERT INTO commission_updates (commission_id, content) VALUES (?, ?)',
        )
        .bind(input.commissionId, input.content)
        .run()

      return { ok: true }
    },
  }),
  addCommissionComment: defineAction({
    accept: 'form',
    input: z.object({
      commissionId: z.number(),
      content: z.preprocess(
        formText,
        z.string().min(1, '请输入评论内容').max(500, '评论最多 500 个字'),
      ),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const commission = await db
        .prepare('SELECT id FROM commissions WHERE id = ?')
        .bind(input.commissionId)
        .first<{ id: number }>()
      if (!commission) {
        throw new ActionError({ code: 'NOT_FOUND', message: '该委托不存在' })
      }

      const comment = await db
        .prepare(
          `INSERT INTO commission_comments (commission_id, profile_token, content)
           VALUES (?, ?, ?)
           RETURNING id, content, created_at`,
        )
        .bind(input.commissionId, profileToken, input.content)
        .first<{
          id: number
          content: string
          created_at: string
        }>()
      if (!comment) {
        throw new Error('插入评论后数据库未返回记录')
      }

      return comment
    },
  }),
  deleteCommissionComment: defineAction({
    accept: 'form',
    input: z.object({
      commentId: z.number(),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const comment = await db
        .prepare(
          `SELECT c.id, c.commission_id, c.profile_token, co.author_token
           FROM commission_comments c
           JOIN commissions co ON co.id = c.commission_id
           WHERE c.id = ?`,
        )
        .bind(input.commentId)
        .first<{
          id: number
          commission_id: number
          profile_token: string
          author_token: string
        }>()
      if (!comment) {
        throw new ActionError({ code: 'NOT_FOUND', message: '评论不存在' })
      }
      if (
        comment.profile_token !== profileToken &&
        comment.author_token !== profileToken
      ) {
        throw new ActionError({ code: 'FORBIDDEN', message: '无权删除该评论' })
      }

      await db
        .prepare('DELETE FROM commission_comments WHERE id = ?')
        .bind(input.commentId)
        .run()

      return { ok: true }
    },
  }),
}
