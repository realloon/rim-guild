import { defineAction, ActionError } from 'astro:actions'
import type { ActionAPIContext } from 'astro:actions'
import { z } from 'astro/zod'
import { env } from 'cloudflare:workers'
import { AUTHOR_COOKIE } from '../lib/posts'
import {
  SESSION_TTL_SECONDS,
  createSession,
  deleteSession,
  generateSalt,
  hashPassword,
  verifyPassword,
} from '../lib/auth'

const roleTypes = [
  'artist',
  'xml',
  'csharp',
  'writer',
  'translator',
  'other',
] as const
const postTags = ['weapon', 'race', 'framework'] as const

const text = (min: number, message: string, max?: number) =>
  z.preprocess(
    v => (v == null ? '' : String(v).trim()),
    max
      ? z.string().min(min, message).max(max, message)
      : z.string().min(min, message),
  )

const postInput = {
  title: text(2, '标题至少 2 个字', 80),
  description: z.preprocess(
    v => (v == null ? '' : String(v).trim()),
    z.string().max(5000, '描述最多 5000 个字'),
  ),
  tags: z.array(z.enum(postTags)).default([]),
  roleTypes: z.array(z.enum(roleTypes)),
  roleDescriptions: z.array(
    z.preprocess(
      v => (v == null ? '' : String(v).trim()),
      z.string().min(1, '每类需求请填写具体内容'),
    ),
  ),
  roleCounts: z.array(
    z.preprocess(
      v => (v == null ? 1 : Number(v)),
      z.number().int().min(1).max(99),
    ),
  ),
}

function validateRolePairs(
  roleTypes: string[],
  roleDescriptions: string[],
  roleCounts: number[],
) {
  if (roleTypes.length === 0) {
    throw new ActionError({
      code: 'BAD_REQUEST',
      message: '请至少添加一项招揽需求',
    })
  }
  if (
    roleTypes.length !== roleDescriptions.length ||
    roleTypes.length !== roleCounts.length
  ) {
    throw new ActionError({
      code: 'BAD_REQUEST',
      message: '招揽类型、需求与人数不匹配',
    })
  }
}

function setAuthCookie(context: ActionAPIContext, sessionToken: string) {
  context.cookies.set(AUTHOR_COOKIE, sessionToken, {
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
  })
}

/** 当前登录用户 profile token；未登录抛错 */
function requireAuth(context: ActionAPIContext) {
  const profileToken = context.locals.auth?.profileToken
  if (!profileToken) {
    throw new ActionError({ code: 'UNAUTHORIZED', message: '请先登录' })
  }
  return profileToken
}

async function assertOwner(postId: number, context: ActionAPIContext) {
  const profileToken = context.locals.auth?.profileToken
  if (!profileToken) {
    throw new ActionError({ code: 'FORBIDDEN', message: '无权操作' })
  }
  const db = env.rim_guild_db
  const post = await db
    .prepare('SELECT author_token FROM posts WHERE id = ?')
    .bind(postId)
    .first<{ author_token: string }>()
  if (!post || post.author_token !== profileToken) {
    throw new ActionError({ code: 'FORBIDDEN', message: '无权操作' })
  }
}

export const server = {
  createPost: defineAction({
    accept: 'form',
    input: z.object(postInput),
    handler: async (input, context) => {
      validateRolePairs(
        input.roleTypes,
        input.roleDescriptions,
        input.roleCounts,
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
          'INSERT INTO posts (title, description, tags, author_name, author_token, author_id) VALUES (?, ?, ?, ?, ?, ?)',
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

      const postId = Number(result.meta.last_row_id)

      await db.batch(
        input.roleTypes.map((role, i) =>
          db
            .prepare(
              'INSERT INTO post_roles (post_id, role_type, description, count) VALUES (?, ?, ?, ?)',
            )
            .bind(postId, role, input.roleDescriptions[i], input.roleCounts[i]),
        ),
      )

      return { id: postId }
    },
  }),
  updatePost: defineAction({
    accept: 'form',
    input: z.object({
      postId: z.number(),
      ...postInput,
    }),
    handler: async (input, context) => {
      validateRolePairs(
        input.roleTypes,
        input.roleDescriptions,
        input.roleCounts,
      )
      await assertOwner(input.postId, context)

      const db = env.rim_guild_db
      const existingRoles = await db
        .prepare('SELECT role_type, status FROM post_roles WHERE post_id = ?')
        .bind(input.postId)
        .all<{ role_type: string; status: string }>()
      const existingStatus = new Map(
        existingRoles.results.map(r => [r.role_type, r.status]),
      )
      const deletedRoles = existingRoles.results.filter(
        r =>
          !input.roleTypes.includes(r.role_type as (typeof roleTypes)[number]),
      )

      await db.batch([
        db
          .prepare(
            'UPDATE posts SET title = ?, description = ?, tags = ? WHERE id = ?',
          )
          .bind(
            input.title,
            input.description || '',
            input.tags.join(','),
            input.postId,
          ),
        ...input.roleTypes.map((role, i) =>
          db
            .prepare(
              `INSERT INTO post_roles (post_id, role_type, description, count, status) VALUES (?, ?, ?, ?, ?)
							ON CONFLICT (post_id, role_type) DO UPDATE SET description = excluded.description, count = excluded.count`,
            )
            .bind(
              input.postId,
              role,
              input.roleDescriptions[i],
              input.roleCounts[i],
              existingStatus.get(role) ?? 'open',
            ),
        ),
        ...deletedRoles.map(r =>
          db
            .prepare(
              'DELETE FROM post_roles WHERE post_id = ? AND role_type = ?',
            )
            .bind(input.postId, r.role_type),
        ),
      ])

      return { id: input.postId }
    },
  }),
  updateRoleStatus: defineAction({
    accept: 'form',
    input: z.object({
      postId: z.number(),
      roleType: z.enum(roleTypes),
      status: z.enum(['open', 'closed']),
    }),
    handler: async (input, context) => {
      await assertOwner(input.postId, context)

      const db = env.rim_guild_db
      await db
        .prepare(
          'UPDATE post_roles SET status = ? WHERE post_id = ? AND role_type = ?',
        )
        .bind(input.status, input.postId, input.roleType)
        .run()

      return { id: input.postId }
    },
  }),
  deletePost: defineAction({
    accept: 'form',
    input: z.object({
      postId: z.number(),
    }),
    handler: async (input, context) => {
      await assertOwner(input.postId, context)

      const db = env.rim_guild_db
      await db.batch([
        db
          .prepare('DELETE FROM post_roles WHERE post_id = ?')
          .bind(input.postId),
        db.prepare('DELETE FROM posts WHERE id = ?').bind(input.postId),
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
      roles: z.array(z.enum(roleTypes)).default([]),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const existing = await db
        .prepare('SELECT author_id FROM profiles WHERE token = ?')
        .bind(profileToken)
        .first<{ author_id: string }>()

      const roles = input.roles.join(',')
      await db
        .prepare(
          'UPDATE profiles SET author_name = ?, qq = ?, github = ?, steam = ?, roles = ? WHERE token = ?',
        )
        .bind(
          input.authorName,
          input.qq,
          input.github,
          input.steam,
          roles,
          profileToken,
        )
        .run()
      await db
        .prepare(
          'UPDATE posts SET author_name = ?, author_id = ? WHERE author_token = ?',
        )
        .bind(input.authorName, existing!.author_id, profileToken)
        .run()

      return { ok: true }
    },
  }),
  register: defineAction({
    accept: 'form',
    input: z.object({
      email: z.preprocess(
        v => (v == null ? '' : String(v).trim().toLowerCase()),
        z
          .string()
          .max(200)
          .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '请输入有效的邮箱地址'),
      ),
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
      setAuthCookie(context, sessionToken)

      return { ok: true }
    },
  }),
  login: defineAction({
    accept: 'form',
    input: z.object({
      email: z.preprocess(
        v => (v == null ? '' : String(v).trim().toLowerCase()),
        z
          .string()
          .max(200)
          .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '请输入有效的邮箱地址'),
      ),
      password: z.string().min(1, '请输入密码'),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profile = await db
        .prepare(
          'SELECT token, author_id, author_name, password_hash, password_salt FROM profiles WHERE email = ?',
        )
        .bind(input.email)
        .first<{
          token: string
          author_id: string
          author_name: string
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
      setAuthCookie(context, sessionToken)

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
      context.cookies.set(AUTHOR_COOKIE, '', {
        maxAge: 0,
        path: '/',
      })
      return { ok: true }
    },
  }),
  registerInterest: defineAction({
    accept: 'form',
    input: z.object({
      postId: z.number(),
      roleType: z.enum(roleTypes),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      const post = await db
        .prepare('SELECT author_token FROM posts WHERE id = ?')
        .bind(input.postId)
        .first<{ author_token: string }>()
      if (!post) {
        throw new ActionError({ code: 'NOT_FOUND', message: '该需求不存在' })
      }
      if (post.author_token === profileToken) {
        throw new ActionError({
          code: 'BAD_REQUEST',
          message: '不能认领自己发布的需求',
        })
      }

      await db
        .prepare(
          'INSERT OR IGNORE INTO responses (post_id, role_type, profile_token) VALUES (?, ?, ?)',
        )
        .bind(input.postId, input.roleType, profileToken)
        .run()

      return { ok: true }
    },
  }),
  cancelInterest: defineAction({
    accept: 'form',
    input: z.object({
      postId: z.number(),
      roleType: z.enum(roleTypes),
    }),
    handler: async (input, context) => {
      const db = env.rim_guild_db
      const profileToken = requireAuth(context)

      await db
        .prepare(
          'DELETE FROM responses WHERE post_id = ? AND role_type = ? AND profile_token = ?',
        )
        .bind(input.postId, input.roleType, profileToken)
        .run()

      return { ok: true }
    },
  }),
  addPostUpdate: defineAction({
    accept: 'form',
    input: z.object({
      postId: z.number(),
      content: z.preprocess(
        v => (v == null ? '' : String(v).trim()),
        z.string().min(1, '请输入更新内容').max(1000, '更新内容最多 1000 个字'),
      ),
    }),
    handler: async (input, context) => {
      await assertOwner(input.postId, context)

      const db = env.rim_guild_db
      await db
        .prepare('INSERT INTO post_updates (post_id, content) VALUES (?, ?)')
        .bind(input.postId, input.content)
        .run()

      return { id: input.postId }
    },
  }),
}
