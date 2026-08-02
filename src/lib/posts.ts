export const ROLE_TYPES = {
	artist: '画师',
	developer: '开发者',
	writer: '文案/翻译',
	audio: '音频/作曲',
	other: '其他',
} as const

export type RoleType = keyof typeof ROLE_TYPES

export const POST_STATUSES = {
	open: '招聘中',
	closed: '已关闭',
} as const

export type PostStatus = keyof typeof POST_STATUSES

export interface Post {
	id: number
	title: string
	role_type: RoleType
	description: string
	contact: string
	status: PostStatus
	created_at: string
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
