import { ActionError } from 'astro:actions'
import type { ActionAPIContext } from 'astro:actions'

export function formText(value: unknown) {
  return value == null ? '' : String(value).trim()
}

export function requireAuth(context: ActionAPIContext) {
  const profileToken = context.locals.auth?.profileToken
  if (!profileToken) {
    throw new ActionError({ code: 'UNAUTHORIZED', message: '请先登录' })
  }
  return profileToken
}
