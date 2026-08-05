export async function getSiteStats(db: D1Database) {
  const stats = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM commissions) AS commission_count,
        (SELECT COUNT(*) FROM profiles) AS user_count`,
    )
    .first<{ commission_count: number; user_count: number }>()

  if (!stats) {
    throw new Error('无法读取站点统计数据')
  }

  return {
    commissionCount: stats.commission_count,
    registeredUserCount: stats.user_count,
  }
}
