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
  requirementTypeLabel,
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
    z.preprocess(
      formText,
      z.string().min(1, '每项需求请填写具体要求'),
    ),
  ),
  requirementCounts: z.array(
    z.preprocess(
      v => Number(v),
      z.number().int().min(1).max(99),
    ),
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
        .prepare('SELECT author_id, author_name FROM profiles WHERE token = ?')
        .bind(profileToken)
        .first<{ author_id: string; author_name: string }>()

      if (!profile) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '请先完善个人资料',
        })
      }

      const requirementValues = requirements
        .map(() => '(last_insert_rowid(), ?, ?, ?)')
        .join(', ')
      const [commissionResult] = await db.batch([
        db
          .prepare(
            'INSERT INTO commissions (title, description, tags, author_name, author_token, author_id) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .bind(
            input.title,
            input.description,
            input.tags.join(','),
            profile.author_name,
            profileToken,
            profile.author_id,
          ),
        db
          .prepare(
            `INSERT INTO requirements (commission_id, requirement_type, description, count) VALUES ${requirementValues}`,
          )
          .bind(
            ...requirements.flatMap(({ type, description, count }) => [
              type,
              description,
              count,
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
          `SELECT r.requirement_type, r.status, COUNT(c.id) AS claim_count
           FROM requirements r
           LEFT JOIN claims c
             ON c.commission_id = r.commission_id
            AND c.requirement_type = r.requirement_type
           WHERE r.commission_id = ?
           GROUP BY r.requirement_type, r.status`,
        )
        .bind(input.commissionId)
        .all<{
          requirement_type: string
          status: string
          claim_count: number
        }>()
      const existingRequirements = existingRequirementRows.results.map(
        row => ({
          type: parseRequirementType(row.requirement_type),
          status: parseRequirementStatus(row.status),
          claimCount: row.claim_count,
        }),
      )
      const existingRequirementsByType = new Map(
        existingRequirements.map(requirement => [requirement.type, requirement]),
      )
      for (const requirement of requirements) {
        const existingRequirement = existingRequirementsByType.get(
          requirement.type,
        )
        if (
          existingRequirement &&
          requirement.count < existingRequirement.claimCount
        ) {
          throw new ActionError({
            code: 'BAD_REQUEST',
            message: `${requirementTypeLabel(requirement.type)}的需要人数不能少于已认领人数`,
          })
        }
      }
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
              existingRequirementsByType.get(requirement.type)?.status ?? 'open',
            ),
          ),
        ...removedRequirements.map(requirement =>
          db
            .prepare(
              'DELETE FROM claims WHERE commission_id = ? AND requirement_type = ?',
            )
            .bind(input.commissionId, requirement.type),
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
      const [, , , result] = await db.batch([
        db.prepare('DELETE FROM claims WHERE commission_id = ?').bind(input.commissionId),
        db
          .prepare('DELETE FROM commission_updates WHERE commission_id = ?')
          .bind(input.commissionId),
        db
          .prepare('DELETE FROM requirements WHERE commission_id = ?')
          .bind(input.commissionId),
        db.prepare('DELETE FROM commissions WHERE id = ?').bind(input.commissionId),
      ])
      if (result.meta.changes !== 1) {
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
          `INSERT OR IGNORE INTO claims (commission_id, requirement_type, profile_token)
           SELECT ?, ?, ?
           WHERE EXISTS (
             SELECT 1
             FROM requirements r
             WHERE r.commission_id = ?
               AND r.requirement_type = ?
               AND r.status = 'open'
               AND (
                 SELECT COUNT(*)
                 FROM claims c
                 WHERE c.commission_id = r.commission_id
                   AND c.requirement_type = r.requirement_type
               ) < r.count
           )`,
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
            `SELECT r.status, r.count, COUNT(c.id) AS claim_count,
                    EXISTS (
                      SELECT 1 FROM claims own_claim
                      WHERE own_claim.commission_id = r.commission_id
                        AND own_claim.requirement_type = r.requirement_type
                        AND own_claim.profile_token = ?
                    ) AS already_claimed
             FROM requirements r
             LEFT JOIN claims c
               ON c.commission_id = r.commission_id
              AND c.requirement_type = r.requirement_type
             WHERE r.commission_id = ?
               AND r.requirement_type = ?
             GROUP BY r.status, r.count`,
          )
          .bind(
            profileToken,
            input.commissionId,
            input.requirementType,
          )
          .first<{
            status: string
            count: number
            claim_count: number
            already_claimed: number
          }>()
        if (!currentRequirement) {
          throw new ActionError({ code: 'NOT_FOUND', message: '该需求不存在' })
        }
        if (currentRequirement.already_claimed) return { ok: true }
        if (parseRequirementStatus(currentRequirement.status) !== 'open') {
          throw new ActionError({
            code: 'BAD_REQUEST',
            message: '该需求已停止招募',
          })
        }
        if (currentRequirement.claim_count < currentRequirement.count) {
          throw new Error('认领需求时数据库状态发生变化')
        }

        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '该需求已招满',
        })
      }

      return { ok: true }
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

      return { ok: true }
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
      const profileToken = await assertOwner(input.commissionId, context)

      const db = env.rim_guild_db
      const result = await db
        .prepare(
          `INSERT INTO commission_updates (commission_id, content)
           SELECT ?, ?
           WHERE EXISTS (
             SELECT 1 FROM commissions WHERE id = ? AND author_token = ?
           )`,
        )
        .bind(
          input.commissionId,
          input.content,
          input.commissionId,
          profileToken,
        )
        .run()
      if (result.meta.changes !== 1) {
        throw new ActionError({ code: 'NOT_FOUND', message: '该委托不存在' })
      }

      return { ok: true }
    },
  }),
}
