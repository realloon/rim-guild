import { defineAction, ActionError } from 'astro:actions'
import { z } from 'astro/zod'
import { env } from 'cloudflare:workers'
import {
  REQUIREMENT_TYPE_KEYS,
  parseRequirementStatus,
} from '../lib/commissions'
import { commissionActions } from './commission'
import { commentActions } from './comments'
import { accountActions } from './account'
import { requireAuth } from './helpers'

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
  ...commissionActions,
  ...commentActions,
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
            SELECT r.commission_id, r.requirement_type, ?
            FROM requirements r
            JOIN commissions c ON c.id = r.commission_id
            WHERE r.commission_id = ?
              AND r.requirement_type = ?
              AND r.status = 'open'
              AND c.author_token != ?
            ON CONFLICT (commission_id, requirement_type, profile_token) DO NOTHING`,
        )
        .bind(
          profileToken,
          input.commissionId,
          input.requirementType,
          profileToken,
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
}
