import {
  parseRequirementTypes,
  type RequirementType,
} from './commissions'

export interface Profile {
  token: string
  author_id: string
  author_name: string
  qq: string
  github: string
  steam: string
  creator_types: RequirementType[]
  email: string
}

type ContactValues = Pick<Profile, 'qq' | 'github' | 'steam'>

export interface ContactMethod {
  label: string
  value: string
}

const CONTACT_FIELDS = [
  ['qq', 'QQ'],
  ['github', 'GitHub'],
  ['steam', 'Steam'],
] as const

export function listContactMethods(values: ContactValues): ContactMethod[] {
  return CONTACT_FIELDS
    .map(([key, label]) => ({ label, value: values[key] }))
    .filter(contact => contact.value)
}

type ProfileRow = Omit<Profile, 'creator_types'> & {
  creator_types: string
}

const PROFILE_SELECT =
  'SELECT token, author_id, author_name, qq, github, steam, creator_types, email FROM profiles'

function profileFromRow(row: ProfileRow): Profile {
  return {
    ...row,
    creator_types: parseRequirementTypes(row.creator_types),
  }
}

export async function findProfileByToken(
  db: D1Database,
  token: string,
): Promise<Profile | undefined> {
  const row = await db
    .prepare(`${PROFILE_SELECT} WHERE token = ?`)
    .bind(token)
    .first<ProfileRow>()

  return row ? profileFromRow(row) : undefined
}

export async function findProfileByAuthorId(
  db: D1Database,
  authorId: string,
): Promise<Profile | undefined> {
  const row = await db
    .prepare(`${PROFILE_SELECT} WHERE author_id = ?`)
    .bind(authorId)
    .first<ProfileRow>()

  return row ? profileFromRow(row) : undefined
}
