import { defineAction, ActionError } from 'astro:actions'
import { z } from 'astro/zod'
import { env } from 'cloudflare:workers'
import { AUTHOR_COOKIE } from '../lib/posts'

const roleTypes = ['artist', 'developer', 'writer', 'translator', 'other'] as const

const text = (min: number, message: string, max?: number) =>
	z.preprocess(
		(v) => (v == null ? '' : String(v).trim()),
		max ? z.string().min(min, message).max(max, message) : z.string().min(min, message)
	)

export const server = {
	createPost: defineAction({
		accept: 'form',
		input: z.object({
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
		}),
		handler: async (input, context) => {
			if (input.roleTypes.length === 0) {
				throw new ActionError({ code: 'BAD_REQUEST', message: '请至少添加一项招揽需求' })
			}
			if (input.roleTypes.length !== input.roleDescriptions.length) {
				throw new ActionError({
					code: 'BAD_REQUEST',
					message: '招揽类型与需求数量不匹配',
				})
			}

			const db = env.rim_guild_db

			let authorToken = context.cookies.get(AUTHOR_COOKIE)?.value
			if (!authorToken) {
				authorToken = crypto.randomUUID()
				context.cookies.set(AUTHOR_COOKIE, authorToken, {
					maxAge: 60 * 60 * 24 * 365,
					path: '/',
				})
			}

			const profile = await db
				.prepare('SELECT author_name, contact FROM profiles WHERE token = ?')
				.bind(authorToken)
				.first<{ author_name: string; contact: string }>()

			if (!profile) {
				throw new ActionError({
					code: 'BAD_REQUEST',
					message: '请先到「我的主页」完善昵称与联系方式',
				})
			}

			const result = await db
				.prepare(
					'INSERT INTO posts (title, description, contact, author_name, author_token) VALUES (?, ?, ?, ?, ?)'
				)
				.bind(
					input.title,
					input.description || '',
					profile.contact,
					profile.author_name,
					authorToken
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
	updateProfile: defineAction({
		accept: 'form',
		input: z.object({
			authorName: z.preprocess(
				(v) => (v == null ? '' : String(v).trim()),
				z.string().min(1, '请填写你的昵称').max(30, '昵称最多 30 个字')
			),
			contact: text(1, '请填写联系方式', 200),
		}),
		handler: async (input, context) => {
			const authorToken = context.cookies.get(AUTHOR_COOKIE)?.value
			if (!authorToken) {
				throw new ActionError({ code: 'BAD_REQUEST', message: '身份未识别，请先发布一条需求' })
			}

			const db = env.rim_guild_db
			await db
				.prepare(
					`INSERT INTO profiles (token, author_name, contact) VALUES (?, ?, ?)
					ON CONFLICT (token) DO UPDATE SET author_name = excluded.author_name, contact = excluded.contact`
				)
				.bind(authorToken, input.authorName, input.contact)
				.run()
			await db
				.prepare('UPDATE posts SET author_name = ?, contact = ? WHERE author_token = ?')
				.bind(input.authorName, input.contact, authorToken)
				.run()

			return { ok: true }
		},
	}),
}
