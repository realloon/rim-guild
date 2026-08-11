import { defineAction, ActionError } from 'astro:actions'
import { z } from 'astro/zod'
import { env } from 'cloudflare:workers'
import { REQUIREMENT_TYPE_KEYS } from '../lib/commissions'
import {
  clearSessionCookie,
  createSession,
  createSessionToken,
  deleteSession,
  generateSalt,
  hashPassword,
  SESSION_TTL_SECONDS,
  setSessionCookie,
  verifyPassword,
} from '../lib/auth'
import { formText, requireAuth } from './helpers'

const emailSchema = z.preprocess(
  value => formText(value).toLowerCase(),
  z
    .string()
    .max(200)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '请输入有效的邮箱地址'),
)

export const accountActions = {
  updateProfile: defineAction({
    accept: 'form',
    input: z.object({
      authorName: z.preprocess(
        formText,
        z.string().min(1, '请填写你的昵称').max(30, '昵称最多 30 个字'),
      ),
      qq: z.preprocess(formText, z.string().max(50)),
      github: z.preprocess(formText, z.string().max(100)),
      steam: z.preprocess(formText, z.string().max(100)),
      creatorTypes: z.array(z.enum(REQUIREMENT_TYPE_KEYS)).default([]),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const creatorTypes = input.creatorTypes.join(',')
      const profileResult = await db
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
      if (profileResult.meta.changes !== 1) {
        throw new ActionError({ code: 'NOT_FOUND', message: '个人资料不存在' })
      }

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
      const salt = generateSalt()
      const hash = await hashPassword(input.password, salt)
      const defaultName = input.email.split('@')[0]

      const profileToken = crypto.randomUUID()
      const authorId = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
      const sessionToken = createSessionToken()
      const expiresAt = new Date(
        Date.now() + SESSION_TTL_SECONDS * 1000,
      ).toISOString()
      const now = new Date().toISOString()
      const [profileResult, sessionResult] = await db.batch([
        db
          .prepare(
            `INSERT INTO profiles
              (token, author_id, author_name, qq, github, steam, creator_types,
               email, password_hash, password_salt)
             VALUES (?, ?, ?, '', '', '', '', ?, ?, ?)
             ON CONFLICT (email) DO NOTHING`,
          )
          .bind(profileToken, authorId, defaultName, input.email, hash, salt),
        db
          .prepare(
            `INSERT INTO sessions (token, profile_token, expires_at, last_seen_at)
             SELECT ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM profiles WHERE token = ? AND email = ?
             )`,
          )
          .bind(
            sessionToken,
            profileToken,
            expiresAt,
            now,
            profileToken,
            input.email,
          ),
      ])
      if (profileResult.meta.changes !== 1) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '该邮箱已注册，请直接登录',
        })
      }
      if (sessionResult.meta.changes !== 1) {
        throw new Error('注册账号后无法创建登录会话')
      }
      setSessionCookie(context, sessionToken)

      return { ok: true }
    },
  }),
  login: defineAction({
    accept: 'form',
    input: z.object({
      email: emailSchema,
      password: z.string().min(8, '密码至少8位'),
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

      if (!profile) {
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
}
