export const REQUIREMENT_TYPES = {
  artist: '画师',
  xml: 'XML 开发',
  csharp: 'C# 开发',
  writer: '文案',
  translator: '翻译',
  other: '其他',
} as const

export type RequirementType = keyof typeof REQUIREMENT_TYPES

export const CREATOR_TYPES = REQUIREMENT_TYPES
export type CreatorType = RequirementType

export const COMMISSION_TAGS = {
  weapon: '武器',
  race: '种族',
  framework: '框架',
} as const

export type CommissionTag = keyof typeof COMMISSION_TAGS

export const REQUIREMENT_STATUSES = {
  open: '招募中',
  closed: '已招满',
} as const

export type RequirementStatus = keyof typeof REQUIREMENT_STATUSES

export interface CommissionRequirement {
  type: RequirementType
  description: string
  count: number
  status: RequirementStatus
}

export interface Commission {
  id: number
  title: string
  description: string
  tags: CommissionTag[]
  requirements: CommissionRequirement[]
  author_name: string
  author_token: string
  author_id: string
  author_qq: string
  author_github: string
  author_steam: string
  created_at: string
}

export type CommissionRow = Omit<Commission, 'tags' | 'requirements'> & {
  tags: string
  requirements: string | null
}

export const AUTHOR_COOKIE = 'guild_author'

export const COMMISSION_SELECT = `
	SELECT c.*, prf.qq AS author_qq, prf.github AS author_github, prf.steam AS author_steam, COALESCE(
		json_group_array(json_object('type', cr.requirement_type, 'description', cr.description, 'count', cr.count, 'status', cr.status))
			FILTER (WHERE cr.commission_id IS NOT NULL),
		'[]'
	) AS requirements
	FROM commissions c
	LEFT JOIN profiles prf ON prf.token = c.author_token
	LEFT JOIN requirements cr ON cr.commission_id = c.id
`

export function commissionFromRow(row: CommissionRow): Commission {
  return {
    ...row,
    tags: row.tags
      ? (row.tags.split(',').filter(Boolean) as CommissionTag[])
      : [],
    requirements: JSON.parse(row.requirements ?? '[]') as CommissionRequirement[],
  }
}

export function requirementTypeLabel(type: RequirementType) {
  return REQUIREMENT_TYPES[type] ?? type
}

export function tagLabel(tag: CommissionTag) {
  return COMMISSION_TAGS[tag] ?? tag
}

export function requirementStatusLabel(status: RequirementStatus) {
  return REQUIREMENT_STATUSES[status] ?? status
}

export function formatDate(iso: string) {
  return new Date(iso + 'Z').toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
