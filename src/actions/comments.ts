import { defineAction, ActionError } from 'astro:actions'
import { z } from 'astro/zod'
import { env } from 'cloudflare:workers'
import { deleteCommissionComment } from '../lib/commission-mutations'
import { formText, requireAuth } from './helpers'

export const commentActions = {
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
      const comment = await db
        .prepare(
          `INSERT INTO commission_comments (commission_id, profile_token, content)
           SELECT ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM commissions WHERE id = ?)
           RETURNING id, content, created_at`,
        )
        .bind(
          input.commissionId,
          profileToken,
          input.content,
          input.commissionId,
        )
        .first<{
          id: number
          content: string
          created_at: string
        }>()

      if (!comment) {
        throw new ActionError({ code: 'NOT_FOUND', message: '该委托不存在' })
      }

      return comment
    },
  }),

  deleteCommissionComment: defineAction({
    accept: 'form',
    input: z.object({ commentId: z.number() }),
    handler: async (input, context) => {
      const deleted = await deleteCommissionComment(
        env.rim_guild_db,
        requireAuth(context),
        input.commentId,
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
}
