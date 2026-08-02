export const ROLE_TYPES = {
	artist: '画师',
	developer: '开发者',
	writer: '文案',
	translator: '翻译',
	other: '其他',
} as const

export type RoleType = keyof typeof ROLE_TYPES

export const POST_STATUSES = {
	open: '招聘中',
	closed: '已招到',
} as const

export type PostStatus = keyof typeof POST_STATUSES

export interface PostRole {
	type: RoleType
	description: string
}

export interface Post {
	id: number
	title: string
	description: string
	roles: PostRole[]
	contact: string
	author_name: string
	author_token: string
	author_id: string
	status: PostStatus
	created_at: string
}

interface PostRow {
	id: number
	title: string
	description: string
	roles: string | null
	contact: string
	author_name: string
	author_token: string
	author_id: string
	status: PostStatus
	created_at: string
}

export const AUTHOR_COOKIE = 'guild_author'

export const POST_SELECT = `
	SELECT p.*, COALESCE(
		json_group_array(json_object('type', pr.role_type, 'description', pr.description))
			FILTER (WHERE pr.post_id IS NOT NULL),
		'[]'
	) AS roles
	FROM posts p
	LEFT JOIN post_roles pr ON pr.post_id = p.id
`

export function postFromRow(row: PostRow): Post {
	return {
		...row,
		roles: JSON.parse(row.roles ?? '[]') as PostRole[],
	}
}

export function roleLabel(role: RoleType): string {
	return ROLE_TYPES[role] ?? role
}

export function statusLabel(status: PostStatus): string {
	return POST_STATUSES[status] ?? status
}

export function formatDate(iso: string): string {
	return new Date(iso + 'Z').toLocaleString('zh-CN', {
		dateStyle: 'medium',
		timeStyle: 'short',
	})
}
