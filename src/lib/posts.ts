export const ROLE_TYPES = {
	artist: '画师',
	xml: 'XML 开发',
	csharp: 'C# 开发',
	writer: '文案',
	translator: '翻译',
	other: '其他',
} as const

export type RoleType = keyof typeof ROLE_TYPES

export const POST_TAGS = {
	weapon: '武器',
	race: '种族',
	framework: '框架',
} as const

export type PostTag = keyof typeof POST_TAGS

export const ROLE_STATUSES = {
	open: '招聘中',
	closed: '已招到',
} as const

export type RoleStatus = keyof typeof ROLE_STATUSES

export interface PostRole {
	type: RoleType
	description: string
	count: number
	status: RoleStatus
}

export interface Post {
	id: number
	title: string
	description: string
	tags: PostTag[]
	roles: PostRole[]
	author_name: string
	author_token: string
	author_id: string
	author_qq: string
	author_github: string
	author_steam: string
	created_at: string
}

interface PostRow {
	id: number
	title: string
	description: string
	tags: string
	roles: string | null
	author_name: string
	author_token: string
	author_id: string
	author_qq: string
	author_github: string
	author_steam: string
	created_at: string
}

export const AUTHOR_COOKIE = 'guild_author'

export const POST_SELECT = `
	SELECT p.*, prf.qq AS author_qq, prf.github AS author_github, prf.steam AS author_steam, COALESCE(
		json_group_array(json_object('type', pr.role_type, 'description', pr.description, 'count', pr.count, 'status', pr.status))
			FILTER (WHERE pr.post_id IS NOT NULL),
		'[]'
	) AS roles
	FROM posts p
	LEFT JOIN profiles prf ON prf.token = p.author_token
	LEFT JOIN post_roles pr ON pr.post_id = p.id
`

export function postFromRow(row: PostRow): Post {
	return {
		...row,
		tags: row.tags ? (row.tags.split(',').filter(Boolean) as PostTag[]) : [],
		roles: JSON.parse(row.roles ?? '[]') as PostRole[],
	}
}

export function roleLabel(role: RoleType): string {
	return ROLE_TYPES[role] ?? role
}

export function tagLabel(tag: PostTag): string {
	return POST_TAGS[tag] ?? tag
}

export function roleStatusLabel(status: RoleStatus): string {
	return ROLE_STATUSES[status] ?? status
}

export function formatDate(iso: string): string {
	return new Date(iso + 'Z').toLocaleString('zh-CN', {
		dateStyle: 'medium',
		timeStyle: 'short',
	})
}
