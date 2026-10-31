import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'chat_session';
export const SESSION_TTL_SECONDS = 2 * 60 * 60;

const mac = (secret: string, exp: string): string => createHmac('sha256', secret).update(`chat_session:${exp}`).digest('base64url');

/** Cookie value `exp.hmac`, where exp is the expiry in Unix seconds. `now` is in milliseconds. */
export function issueSession(secret: string, now: number): string {
  const exp = String(Math.floor(now / 1000) + SESSION_TTL_SECONDS);
  return `${exp}.${mac(secret, exp)}`;
}

export function verifySession(secret: string, value: string | undefined, now: number): boolean {
  if (!value) return false;
  const match = /^(\d{1,12})\.([\w-]{43})$/.exec(value);
  if (!match) return false;
  const [, exp, given] = match as unknown as [string, string, string];
  const expected = Buffer.from(mac(secret, exp));
  if (!timingSafeEqual(Buffer.from(given), expected)) return false;
  return Number(exp) * 1000 > now;
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${SESSION_TTL_SECONDS}`;
}

/** Reads the session cookie value from a Cookie header. */
export function readSessionCookie(header: string | null): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}
