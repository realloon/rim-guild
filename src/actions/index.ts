import { defineAction } from 'astro:actions'
import { z } from 'astro/zod'
import { env } from 'cloudflare:workers'

export const server = {
	createPost: defineAction({
		accept: 'form',
		input: z.object({
			title: z.preprocess(
				(v) => (v == null ? '' : String(v).trim()),
				z.string().min(2, '标题至少 2 个字').max(80, '标题最多 80 个字')
			),
			roleType: z.enum(['artist', 'developer', 'writer', 'audio', 'other']),
			description: z.preprocess(
				(v) => (v == null ? '' : String(v).trim()),
				z.string().min(10, '需求描述至少 10 个字').max(5000, '需求描述最多 5000 个字')
			),
			contact: z.preprocess(
				(v) => (v == null ? '' : String(v).trim()),
				z.string().min(1, '请填写联系方式').max(200, '联系方式最多 200 个字')
			),
		}),
		handler: async (input) => {
			const db = env.rim_guild_db

			const result = await db
				.prepare(
					'INSERT INTO posts (title, role_type, description, contact) VALUES (?, ?, ?, ?)'
				)
				.bind(input.title, input.roleType, input.description, input.contact)
				.run()

			return { id: Number(result.meta.last_row_id) }
		},
	}),
}
