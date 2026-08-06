import { env } from 'cloudflare:workers'
import {
  AUTHOR_COOKIE,
  clearSessionCookie,
  setSessionCookie,
  touchSession,
} from './lib/auth'

export async function onRequest(
  context: import('astro').APIContext,
  next: () => Promise<Response>,
) {
  context.locals.auth = null
  const sessionToken = context.cookies.get(AUTHOR_COOKIE)?.value

  if (sessionToken) {
    const result = await touchSession(env.rim_guild_db, sessionToken)
    if (result) {
      context.locals.auth = { sessionToken, profileToken: result.profileToken }
      if (result.renewed) {
        setSessionCookie(context, sessionToken)
      }
    } else {
      clearSessionCookie(context)
    }
  }

  return next()
}
