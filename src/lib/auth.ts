// 账号密码：PBKDF2-SHA256 哈希（WebCrypto，Workers 原生支持）
// 注册/登录：注册创建账号 → 登录签发 session cookie；登出删除 session
// cookie（guild_author）即 session token，7 天滑动过期

import { AUTHOR_COOKIE } from './commissions'

const ITERATIONS = 310_000
const KEY_LEN = 32
const SALT_BYTES = 16

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(hex.match(/.{2}/g)?.map(h => parseInt(h, 16)) ?? [])
}

export function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  return toHex(bytes.buffer)
}

export async function hashPassword(password: string, salt: string) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromHex(salt),
      iterations: ITERATIONS,
    },
    keyMaterial,
    KEY_LEN * 8,
  )
  return toHex(bits)
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
) {
  const actual = await hashPassword(password, salt)
  return actual === expectedHash
}

// ---- 会话（7 天滑动过期） ----
export const SESSION_TTL_SECONDS = 7 * 24 * 3600
export const SESSION_RENEW_THRESHOLD_SECONDS = SESSION_TTL_SECONDS / 2

type CookieContext = { cookies: import('astro').AstroCookies }

export function setSessionCookie(context: CookieContext, token: string) {
  context.cookies.set(AUTHOR_COOKIE, token, {
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: import.meta.env.PROD,
  })
}

export function clearSessionCookie(context: CookieContext) {
  context.cookies.set(AUTHOR_COOKIE, '', { maxAge: 0, path: '/' })
}

export async function createSession(db: D1Database, profileToken: string) {
  const token = crypto.randomUUID()
  await db
    .prepare(
      'INSERT INTO sessions (token, profile_token, expires_at) VALUES (?, ?, ?)',
    )
    .bind(
      token,
      profileToken,
      new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    )
    .run()
  return token
}

/** 校验并滑动续期；有效返回 profileToken 与是否续期，过期/不存在返回 null */
export async function touchSession(db: D1Database, token: string) {
  const row = await db
    .prepare('SELECT profile_token, expires_at FROM sessions WHERE token = ?')
    .bind(token)
    .first<{ profile_token: string; expires_at: string }>()
  if (!row) return null

  const expiresAt = Date.parse(row.expires_at)
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
    return null
  }

  const remainSeconds = (expiresAt - Date.now()) / 1000
  if (remainSeconds < SESSION_RENEW_THRESHOLD_SECONDS) {
    await db
      .prepare(
        'UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token = ?',
      )
      .bind(
        new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
        new Date().toISOString(),
        token,
      )
      .run()
    return { profileToken: row.profile_token, renewed: true }
  }
  return { profileToken: row.profile_token, renewed: false }
}

export async function deleteSession(db: D1Database, token: string) {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
}
