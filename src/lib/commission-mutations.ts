import type { RequirementType } from './commissions'
import type { RequirementInput } from './requirements'

interface CommissionFields {
  title: string
  description: string
  tags: string
}

export async function createCommission(
  db: D1Database,
  authorToken: string,
  fields: CommissionFields,
  requirements: RequirementInput[],
) {
  const requirementValues = requirements
    .map(() => '(last_insert_rowid(), ?, ?, ?, ?)')
    .join(', ')

  const [commissionResult] = await db.batch([
    db
      .prepare(
        'INSERT INTO commissions (title, description, tags, author_token) VALUES (?, ?, ?, ?)',
      )
      .bind(fields.title, fields.description, fields.tags, authorToken),
    db
      .prepare(
        `INSERT INTO requirements (commission_id, requirement_type, description, count, status) VALUES ${requirementValues}`,
      )
      .bind(
        ...requirements.flatMap(({ type, description, count }) => [
          type,
          description,
          count,
          'open',
        ]),
      ),
  ])

  return Number(commissionResult.meta.last_row_id)
}

export async function updateCommission(
  db: D1Database,
  authorToken: string,
  commissionId: number,
  fields: CommissionFields,
  requirements: RequirementInput[],
) {
  const existingRows = await db
    .prepare(
      `SELECT r.requirement_type, r.status
       FROM requirements r
       JOIN commissions c ON c.id = r.commission_id
       WHERE r.commission_id = ? AND c.author_token = ?`,
    )
    .bind(commissionId, authorToken)
    .all<{ requirement_type: string; status: string }>()

  const requestedTypes = new Set(
    requirements.map(requirement => requirement.type),
  )
  const existingTypes = new Set<RequirementType>(
    existingRows.results.map(row => row.requirement_type as RequirementType),
  )

  const statements = [
    db
      .prepare(
        `UPDATE commissions
         SET title = ?, description = ?, tags = ?
         WHERE id = ? AND author_token = ?`,
      )
      .bind(
        fields.title,
        fields.description,
        fields.tags,
        commissionId,
        authorToken,
      ),
    ...requirements.map(requirement => {
      const existing = existingRows.results.find(
        row => row.requirement_type === requirement.type,
      )
      return db
        .prepare(
          `INSERT INTO requirements
             (commission_id, requirement_type, description, count, status)
           SELECT ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM commissions
             WHERE id = ? AND author_token = ?
           )
           ON CONFLICT (commission_id, requirement_type)
           DO UPDATE SET description = excluded.description, count = excluded.count`,
        )
        .bind(
          commissionId,
          requirement.type,
          requirement.description,
          requirement.count,
          existing?.status ?? 'open',
          commissionId,
          authorToken,
        )
    }),
    ...[...existingTypes]
      .filter(type => !requestedTypes.has(type))
      .map(type =>
        db
          .prepare(
            `DELETE FROM requirements
             WHERE commission_id = ? AND requirement_type = ?
               AND EXISTS (
                 SELECT 1 FROM commissions
                 WHERE id = ? AND author_token = ?
               )`,
          )
          .bind(commissionId, type, commissionId, authorToken),
      ),
  ]

  const [commissionResult] = await db.batch(statements)
  return commissionResult.meta.changes === 1
}

export async function updateRequirementStatus(
  db: D1Database,
  authorToken: string,
  commissionId: number,
  requirementType: string,
  status: string,
) {
  const result = await db
    .prepare(
      `UPDATE requirements
       SET status = ?
       WHERE commission_id = ? AND requirement_type = ?
         AND EXISTS (
           SELECT 1 FROM commissions
           WHERE id = ? AND author_token = ?
         )
       RETURNING commission_id`,
    )
    .bind(status, commissionId, requirementType, commissionId, authorToken)
    .first<{ commission_id: number }>()

  return result !== null
}

export async function deleteCommission(
  db: D1Database,
  authorToken: string,
  commissionId: number,
) {
  const result = await db
    .prepare(
      'DELETE FROM commissions WHERE id = ? AND author_token = ? RETURNING id',
    )
    .bind(commissionId, authorToken)
    .first<{ id: number }>()

  return result !== null
}

export async function addCommissionUpdate(
  db: D1Database,
  authorToken: string,
  commissionId: number,
  content: string,
) {
  const result = await db
    .prepare(
      `INSERT INTO commission_updates (commission_id, content)
       SELECT ?, ?
       WHERE EXISTS (
         SELECT 1 FROM commissions
         WHERE id = ? AND author_token = ?
       )
       RETURNING commission_id`,
    )
    .bind(commissionId, content, commissionId, authorToken)
    .first<{ commission_id: number }>()

  return result !== null
}

export async function deleteCommissionComment(
  db: D1Database,
  profileToken: string,
  commentId: number,
) {
  const result = await db
    .prepare(
      `DELETE FROM commission_comments
       WHERE id = ?
         AND (
           profile_token = ?
           OR EXISTS (
             SELECT 1
             FROM commissions
             WHERE commissions.id = commission_comments.commission_id
               AND commissions.author_token = ?
           )
         )
       RETURNING id`,
    )
    .bind(commentId, profileToken, profileToken)
    .first<{ id: number }>()

  return result !== null
}
