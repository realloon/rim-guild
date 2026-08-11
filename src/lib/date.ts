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
