import { defineAction, ActionError } from 'astro:actions'
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

const roleTypes = ['artist', 'developer', 'writer', 'translator', 'other'] as const

const text = (min: number, message: string, max?: number) =>
	z.preprocess(
		(v) => (v == null ? '' : String(v).trim()),
		max ? z.string().min(min, message).max(max, message) : z.string().min(min, message)
	)

const postInput = {
	title: text(2, '标题至少 2 个字', 80),
	description: z.preprocess(
		(v) => (v == null ? '' : String(v).trim()),
		z.string().max(5000, '描述最多 5000 个字')
	),
	roleTypes: z.array(z.enum(roleTypes)),
	roleDescriptions: z.array(
		z.preprocess(
			(v) => (v == null ? '' : String(v).trim()),
			z.string().min(1, '每类需求请填写具体内容')
		)
	),
}

function validateRolePairs(
	roleTypes: string[],
	roleDescriptions: string[]
): void {
	if (roleTypes.length === 0) {
		throw new ActionError({ code: 'BAD_REQUEST', message: '请至少添加一项招揽需求' })
	}
	if (roleTypes.length !== roleDescriptions.length) {
		throw new ActionError({
			code: 'BAD_REQUEST',
			message: '招揽类型与需求数量不匹配',
		})
	}
}

function setAuthCookie(
	context: import('astro').APIContext,
	sessionToken: string
): void {
	context.cookies.set(AUTHOR_COOKIE, sessionToken, {
		maxAge: SESSION_TTL_SECONDS,
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: import.meta.env.PROD,
	})
}

/** 返回当前身份；无会话时创建 guest 身份并写 cookie */
async function ensureIdentity(
	context: import('astro').APIContext
): Promise<{ profileToken: string; authorId: string }> {
	const db = env.rim_guild_db

	if (context.locals.auth) {
		const row = await db
			.prepare('SELECT author_id FROM profiles WHERE token = ?')
			.bind(context.locals.auth.profileToken)
			.first<{ author_id: string }>()
		return { profileToken: context.locals.auth.profileToken, authorId: row!.author_id }
	}

	const profileToken = crypto.randomUUID()
	const authorId = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
	await db
		.prepare(
			'INSERT INTO profiles (token, author_id, author_name, contact) VALUES (?, ?, ?, ?)'
		)
		.bind(profileToken, authorId, '', '')
		.run()
	const sessionToken = await createSession(db, profileToken)
	setAuthCookie(context, sessionToken)
	return { profileToken, authorId }
}

async function assertOwner(postId: number, context: import('astro').APIContext) {
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
			validateRolePairs(input.roleTypes, input.roleDescriptions)

			const db = env.rim_guild_db
			const { profileToken } = await ensureIdentity(context)

			const profile = await db
				.prepare('SELECT author_id, author_name, contact FROM profiles WHERE token = ?')
				.bind(profileToken)
				.first<{ author_id: string; author_name: string; contact: string }>()

			if (!profile) {
				throw new ActionError({
					code: 'BAD_REQUEST',
					message: '请先到「我的主页」完善昵称与联系方式',
				})
			}

			const result = await db
				.prepare(
					'INSERT INTO posts (title, description, contact, author_name, author_token, author_id) VALUES (?, ?, ?, ?, ?, ?)'
				)
				.bind(
					input.title,
					input.description || '',
					profile.contact,
					profile.author_name,
					profileToken,
					profile.author_id
				)
				.run()

			const postId = Number(result.meta.last_row_id)

			await db.batch(
				input.roleTypes.map((role, i) =>
					db
						.prepare(
							'INSERT INTO post_roles (post_id, role_type, description) VALUES (?, ?, ?)'
						)
						.bind(postId, role, input.roleDescriptions[i])
				)
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
			validateRolePairs(input.roleTypes, input.roleDescriptions)
			await assertOwner(input.postId, context)

			const db = env.rim_guild_db
			await db
				.prepare('UPDATE posts SET title = ?, description = ? WHERE id = ?')
				.bind(input.title, input.description || '', input.postId)
				.run()
			await db.batch([
				db.prepare('DELETE FROM post_roles WHERE post_id = ?').bind(input.postId),
				...input.roleTypes.map((role, i) =>
					db
						.prepare(
							'INSERT INTO post_roles (post_id, role_type, description) VALUES (?, ?, ?)'
						)
						.bind(input.postId, role, input.roleDescriptions[i])
				),
			])

			return { id: input.postId }
		},
	}),
	updatePostStatus: defineAction({
		accept: 'form',
		input: z.object({
			postId: z.number(),
			status: z.enum(['open', 'closed']),
		}),
		handler: async (input, context) => {
			await assertOwner(input.postId, context)

			const db = env.rim_guild_db
			await db
				.prepare('UPDATE posts SET status = ? WHERE id = ?')
				.bind(input.status, input.postId)
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
				db.prepare('DELETE FROM post_roles WHERE post_id = ?').bind(input.postId),
				db.prepare('DELETE FROM posts WHERE id = ?').bind(input.postId),
			])

			return { ok: true }
		},
	}),
	updateProfile: defineAction({
		accept: 'form',
		input: z.object({
			authorName: z.preprocess(
				(v) => (v == null ? '' : String(v).trim()),
				z.string().min(1, '请填写你的昵称').max(30, '昵称最多 30 个字')
			),
			contact: text(1, '请填写联系方式', 200),
			roles: z.array(z.enum(roleTypes)).default([]),
		}),
		handler: async (input, context) => {
			const db = env.rim_guild_db
			const { profileToken, authorId } = await ensureIdentity(context)

			const roles = input.roles.join(',')
			await db
				.prepare(
					`INSERT INTO profiles (token, author_id, author_name, contact, roles) VALUES (?, ?, ?, ?, ?)
					ON CONFLICT (token) DO UPDATE SET author_name = excluded.author_name, contact = excluded.contact, roles = excluded.roles`
				)
				.bind(profileToken, authorId, input.authorName, input.contact, roles)
				.run()
			await db
				.prepare(
					'UPDATE posts SET author_name = ?, contact = ?, author_id = ? WHERE author_token = ?'
				)
				.bind(input.authorName, input.contact, authorId, profileToken)
				.run()

			return { ok: true }
		},
	}),
	register: defineAction({
		accept: 'form',
		input: z.object({
			email: z.preprocess(
				(v) => (v == null ? '' : String(v).trim().toLowerCase()),
				z.string().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '请输入有效的邮箱地址')
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
				throw new ActionError({ code: 'BAD_REQUEST', message: '该邮箱已注册，请直接登录' })
			}

			const salt = generateSalt()
			const hash = await hashPassword(input.password, salt)

			const currentAuth = context.locals.auth
			if (currentAuth) {
				const current = await db
					.prepare('SELECT email FROM profiles WHERE token = ?')
					.bind(currentAuth.profileToken)
					.first<{ email: string }>()
				if (current && current.email === '') {
					// guest 身份原地升级为账号，会话沿用
					await db
						.prepare(
							'UPDATE profiles SET email = ?, password_hash = ?, password_salt = ? WHERE token = ?'
						)
						.bind(input.email, hash, salt, currentAuth.profileToken)
						.run()
					return { ok: true }
				}
			}

			// 新建账号（新 session 绑定）
			const profileToken = crypto.randomUUID()
			const authorId = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
			await db
				.prepare(
					'INSERT INTO profiles (token, author_id, author_name, email, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?)'
				)
				.bind(profileToken, authorId, '', input.email, hash, salt)
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
				(v) => (v == null ? '' : String(v).trim().toLowerCase()),
				z.string().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, '请输入有效的邮箱地址')
			),
			password: z.string().min(1, '请输入密码'),
		}),
		handler: async (input, context) => {
			const db = env.rim_guild_db
			const profile = await db
				.prepare(
					'SELECT token, author_id, author_name, password_hash, password_salt FROM profiles WHERE email = ?'
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
				throw new ActionError({ code: 'BAD_REQUEST', message: '邮箱或密码不正确' })
			}
			const valid = await verifyPassword(input.password, profile.password_salt, profile.password_hash)
			if (!valid) {
				throw new ActionError({ code: 'BAD_REQUEST', message: '邮箱或密码不正确' })
			}

			// 合并当前 guest 身份的帖子到登录账号
			const currentAuth = context.locals.auth
			if (currentAuth && currentAuth.profileToken !== profile.token) {
				const guest = await db
					.prepare('SELECT author_id, author_name, email FROM profiles WHERE token = ?')
					.bind(currentAuth.profileToken)
					.first<{ author_id: string; author_name: string; email: string }>()
				if (guest && guest.email === '') {
					const finalName = profile.author_name || guest.author_name
					await db
						.prepare(
							'UPDATE posts SET author_token = ?, author_id = ?, author_name = ? WHERE author_token = ?'
						)
						.bind(profile.token, profile.author_id, finalName, currentAuth.profileToken)
						.run()
					await db.prepare('DELETE FROM profiles WHERE token = ?').bind(currentAuth.profileToken).run()
					await deleteSession(db, currentAuth.sessionToken)
				}
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
}
