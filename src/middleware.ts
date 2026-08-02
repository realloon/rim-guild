import { env } from 'cloudflare:workers'
import { AUTHOR_COOKIE } from './lib/posts'
import { SESSION_TTL_SECONDS, touchSession } from './lib/auth'

export async function onRequest(
	context: import('astro').APIContext,
	next: () => Promise<Response>
): Promise<Response> {
	const sessionToken = context.cookies.get(AUTHOR_COOKIE)?.value

	if (sessionToken) {
		const result = await touchSession(env.rim_guild_db, sessionToken)
		if (result) {
			context.locals.auth = { sessionToken, profileToken: result.profileToken }
			if (result.renewed) {
				context.cookies.set(AUTHOR_COOKIE, sessionToken, {
					maxAge: SESSION_TTL_SECONDS,
					path: '/',
					httpOnly: true,
					sameSite: 'lax',
					secure: import.meta.env.PROD,
				})
			}
		} else {
			context.cookies.set(AUTHOR_COOKIE, '', {
				maxAge: 0,
				path: '/',
			})
		}
	}

	return next()
}
