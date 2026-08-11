import { defineAction, ActionError } from 'astro:actions'
import { z } from 'astro/zod'
import { env } from 'cloudflare:workers'
import {
  COMMISSION_TAG_KEYS,
  REQUIREMENT_STATUS_KEYS,
  REQUIREMENT_TYPE_KEYS,
} from '../lib/commissions'
import {
  addCommissionUpdate,
  createCommission,
  deleteCommission,
  updateCommission,
  updateRequirementStatus,
} from '../lib/commission-mutations'
import {
  requirementInputError,
  type RequirementFields,
  type RequirementInput,
} from '../lib/requirements'
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

export const commissionActions = {
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

      const id = await createCommission(
        db,
        profileToken,
        {
          title: input.title,
          description: input.description,
          tags: input.tags.join(','),
        },
        requirements,
      )
      return { id }
    },
  }),

  updateCommission: defineAction({
    accept: 'form',
    input: commissionSchema.extend({ commissionId: z.number() }),
    handler: async (input, context) => {
      const requirements = parseRequirementInputs(input)
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)
      const updated = await updateCommission(
        db,
        profileToken,
        input.commissionId,
        {
          title: input.title,
          description: input.description,
          tags: input.tags.join(','),
        },
        requirements,
      )
      if (!updated) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: '你无权执行此操作',
        })
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
      const profileToken = requireAuth(context)
      const updated = await updateRequirementStatus(
        env.rim_guild_db,
        profileToken,
        input.commissionId,
        input.requirementType,
        input.status,
      )
      if (!updated) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: '你无权执行此操作',
        })
      }
      return { id: input.commissionId }
    },
  }),

  deleteCommission: defineAction({
    accept: 'form',
    input: z.object({ commissionId: z.number() }),
    handler: async (input, context) => {
      const deleted = await deleteCommission(
        env.rim_guild_db,
        requireAuth(context),
        input.commissionId,
      )
      if (!deleted) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: '你无权执行此操作',
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
      const inserted = await addCommissionUpdate(
        env.rim_guild_db,
        requireAuth(context),
        input.commissionId,
        input.content,
      )
      if (!inserted) {
        throw new ActionError({
          code: 'FORBIDDEN',
          message: '你无权执行此操作',
        })
      }
      return { ok: true }
    },
  }),
}

export { commissionSchema }
