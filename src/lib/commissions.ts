import { z } from 'astro/zod'

export const REQUIREMENT_TYPES = {
  artist: '画师',
  xml: 'XML 开发',
  csharp: 'C# 开发',
  writer: '文案',
  translator: '翻译',
  other: '其他',
} as const

export type RequirementType = keyof typeof REQUIREMENT_TYPES

export const REQUIREMENT_TYPE_KEYS = Object.keys(REQUIREMENT_TYPES) as [
  RequirementType,
  ...RequirementType[],
]

export const COMMISSION_TAGS = {
  weapon: '武器',
  race: '种族',
  framework: '框架',
} as const

export type CommissionTag = keyof typeof COMMISSION_TAGS

export const COMMISSION_TAG_KEYS = Object.keys(COMMISSION_TAGS) as [
  CommissionTag,
  ...CommissionTag[],
]

export const REQUIREMENT_STATUSES = {
  open: '招募中',
  closed: '已停止',
} as const

export type RequirementStatus = keyof typeof REQUIREMENT_STATUSES

export const REQUIREMENT_STATUS_KEYS = Object.keys(REQUIREMENT_STATUSES) as [
  RequirementStatus,
  ...RequirementStatus[],
]

export interface CommissionRequirement {
  type: RequirementType
  description: string
  count: number
  status: RequirementStatus
}

export interface CommissionSummary {
  id: number
  title: string
  description: string
  requirements: CommissionRequirement[]
  author_name: string
  author_token: string
  author_id: string
  created_at: string
}

export interface Commission extends CommissionSummary {
  tags: CommissionTag[]
  author_qq: string
  author_github: string
  author_steam: string
  view_count: number
}

export interface CommissionClaim {
  commission_id: number
  requirement_type: RequirementType
  profile_token: string
  created_at: string
  author_name: string
  author_id: string
}

export interface CommissionUpdate {
  id: number
  content: string
  created_at: string
}

export interface CommissionComment {
  id: number
  commission_id: number
  profile_token: string
  author_name: string
  author_id: string
  content: string
  created_at: string
}

export type CommissionRow = Omit<Commission, 'tags' | 'requirements'> & {
  tags: string
  requirements: string
}

export const isRequirementType = (value: string): value is RequirementType =>
  Object.hasOwn(REQUIREMENT_TYPES, value)

const isCommissionTag = (value: string): value is CommissionTag =>
  Object.hasOwn(COMMISSION_TAGS, value)

function parseCsv<T>(value: string, parseValue: (value: string) => T): T[] {
  return value ? value.split(',').map(parseValue) : []
}

export function parseRequirementType(value: string): RequirementType {
  if (!isRequirementType(value)) {
    throw new Error(`数据库包含未知需求类型: ${value}`)
  }
  return value
}

export function parseRequirementTypes(value: string): RequirementType[] {
  return parseCsv(value, parseRequirementType)
}

function parseCommissionTag(value: string): CommissionTag {
  if (!isCommissionTag(value)) {
    throw new Error(`数据库包含未知委托标签: ${value}`)
  }
  return value
}

function parseCommissionTags(value: string): CommissionTag[] {
  return parseCsv(value, parseCommissionTag)
}

const requirementTypeSchema = z.enum(REQUIREMENT_TYPE_KEYS)
const requirementStatusSchema = z.enum(REQUIREMENT_STATUS_KEYS)
const requirementSchema = z.object({
  type: requirementTypeSchema,
  description: z.string(),
  count: z.number().int().min(1).max(99),
  status: requirementStatusSchema,
})

export function parseRequirementStatus(value: string): RequirementStatus {
  return requirementStatusSchema.parse(value)
}

function parseRequirements(value: string): CommissionRequirement[] {
  return z.array(requirementSchema).parse(JSON.parse(value))
}

type CommissionClaimRow = Omit<CommissionClaim, 'requirement_type'> & {
  requirement_type: string
}

function parseClaim(claim: CommissionClaimRow): CommissionClaim {
  return {
    ...claim,
    requirement_type: parseRequirementType(claim.requirement_type),
  }
}

export const COMMISSION_SELECT = `
  SELECT c.id, c.title, c.description, c.tags, c.view_count, c.created_at,
    p.author_name, p.token AS author_token, p.author_id,
    p.qq AS author_qq, p.github AS author_github, p.steam AS author_steam,
    json_group_array(
      json_object(
        'type', r.requirement_type,
        'description', r.description,
        'count', r.count,
        'status', r.status
      )
    ) FILTER (WHERE r.commission_id IS NOT NULL) AS requirements
  FROM commissions c
  JOIN profiles p ON p.token = c.author_token
  LEFT JOIN requirements r ON r.commission_id = c.id
`

export function commissionFromRow(row: CommissionRow): Commission {
  return {
    ...row,
    tags: parseCommissionTags(row.tags),
    requirements: parseRequirements(row.requirements),
  }
}

export async function findCommission(
  db: D1Database,
  id: number,
): Promise<Commission | undefined> {
  const row = await db
    .prepare(`${COMMISSION_SELECT} WHERE c.id = ? GROUP BY c.id`)
    .bind(id)
    .first<CommissionRow>()

  return row ? commissionFromRow(row) : undefined
}

export async function incrementCommissionViews(
  db: D1Database,
  commissionId: number,
  excludeToken: string | null,
): Promise<number | null> {
  const row = await db
    .prepare(
      `UPDATE commissions
       SET view_count = view_count + 1
       WHERE id = ?
         AND (? IS NULL OR author_token != ?)
       RETURNING view_count`,
    )
    .bind(commissionId, excludeToken, excludeToken)
    .first<{ view_count: number }>()

  return row?.view_count ?? null
}

export async function listCommissionsByAuthor(
  db: D1Database,
  authorToken: string,
): Promise<Commission[]> {
  const { results } = await db
    .prepare(
      `${COMMISSION_SELECT}
			WHERE c.author_token = ?
			GROUP BY c.id
			ORDER BY c.created_at DESC, c.id DESC`,
    )
    .bind(authorToken)
    .all<CommissionRow>()

  return results.map(commissionFromRow)
}

export async function listOpenCommissions(
  db: D1Database,
  {
    requirementType,
    search,
  }: { requirementType?: RequirementType; search?: string } = {},
): Promise<Commission[]> {
  const conditions = [
    `EXISTS (
      SELECT 1 FROM requirements r
      WHERE r.commission_id = c.id AND r.status = 'open'
    )`,
  ]
  const params: string[] = []

  if (requirementType) {
    conditions.push(`EXISTS (
      SELECT 1 FROM requirements r
      WHERE r.commission_id = c.id
        AND r.requirement_type = ?
        AND r.status = 'open'
    )`)
    params.push(requirementType)
  }

  if (search) {
    const escaped = search.replace(/[\\%_]/g, character => `\\${character}`)
    conditions.push(`(
      c.title LIKE ? ESCAPE '\\'
      OR c.description LIKE ? ESCAPE '\\'
    )`)
    params.push(`%${escaped}%`, `%${escaped}%`)
  }

  const { results } = await db
    .prepare(
      `${COMMISSION_SELECT}
       WHERE ${conditions.join('\n       AND ')}
       GROUP BY c.id
       ORDER BY c.created_at DESC, c.id DESC`,
    )
    .bind(...params)
    .all<CommissionRow>()

  return results.map(commissionFromRow)
}

export async function listCommissionUpdates(
  db: D1Database,
  commissionId: number,
): Promise<CommissionUpdate[]> {
  const { results } = await db
    .prepare(
      'SELECT id, content, created_at FROM commission_updates WHERE commission_id = ? ORDER BY created_at DESC, id DESC',
    )
    .bind(commissionId)
    .all<CommissionUpdate>()

  return results
}

export async function listCommissionComments(
  db: D1Database,
  commissionId: number,
): Promise<CommissionComment[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.commission_id, c.profile_token, c.content, c.created_at,
              p.author_name, p.author_id
       FROM commission_comments c
       JOIN profiles p ON p.token = c.profile_token
       WHERE c.commission_id = ?
       ORDER BY c.created_at ASC, c.id ASC`,
    )
    .bind(commissionId)
    .all<CommissionComment>()

  return results
}

export async function listCommissionClaims(
  db: D1Database,
  commissionId: number,
): Promise<CommissionClaim[]> {
  const { results } = await db
    .prepare(
      `SELECT r.commission_id, r.requirement_type, r.profile_token, r.created_at, p.author_name, p.author_id
			FROM claims r
			JOIN profiles p ON p.token = r.profile_token
			WHERE r.commission_id = ?
			ORDER BY r.created_at ASC`,
    )
    .bind(commissionId)
    .all<CommissionClaimRow>()

  return results.map(parseClaim)
}

interface ClaimedCommissionRow {
  commission_id: number
  commission_title: string
  commission_description: string
  author_name: string
  author_token: string
  author_id: string
  requirement_type: string
  created_at: string
  requirement_status: string
  count: number
  requirement_description: string
}

export async function listClaimedCommissions(
  db: D1Database,
  profileToken: string,
): Promise<CommissionSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id AS commission_id, c.title AS commission_title,
        c.description AS commission_description,
        p.author_name, p.token AS author_token, p.author_id, c.created_at,
        cr.status AS requirement_status, cr.count,
        cr.description AS requirement_description, r.requirement_type
        FROM claims r
        JOIN commissions c ON c.id = r.commission_id
        JOIN profiles p ON p.token = c.author_token
        JOIN requirements cr
          ON cr.commission_id = r.commission_id
         AND cr.requirement_type = r.requirement_type
        WHERE r.profile_token = ?
        ORDER BY r.created_at DESC`,
    )
    .bind(profileToken)
    .all<ClaimedCommissionRow>()

  return results.map(claim => ({
    id: claim.commission_id,
    title: claim.commission_title,
    description: claim.commission_description,
    requirements: [
      {
        type: parseRequirementType(claim.requirement_type),
        description: claim.requirement_description,
        count: claim.count,
        status: parseRequirementStatus(claim.requirement_status),
      },
    ],
    author_name: claim.author_name,
    author_token: claim.author_token,
    author_id: claim.author_id,
    created_at: claim.created_at,
  }))
}

export function requirementTypeLabel(type: RequirementType) {
  return REQUIREMENT_TYPES[type]
}

export function tagLabel(tag: CommissionTag) {
  return COMMISSION_TAGS[tag]
}

export function requirementStatusLabel(status: RequirementStatus) {
  return REQUIREMENT_STATUSES[status]
}

export function formatDate(iso: string) {
  const date = new Date(iso + 'Z')
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`数据库包含无效时间: ${iso}`)
  }

  return date.toLocaleString('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
