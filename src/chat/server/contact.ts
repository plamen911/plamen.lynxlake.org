import { hourKey, dayKey, type Env } from './env';
import { checkAndCountRate, pruneRate, rateBucket, sessionHash, visitorHash } from './limits';
import { notifyContact } from './notify';
import { issueSession, readSessionCookie, sessionCookie, verifySession } from './session';
import { parseHostnames, verifyTurnstile } from './turnstile';

export const MAX_CONTACT_BODY_BYTES = 8 * 1024;
export const MAX_EMAIL_CHARS = 254;
export const MAX_NAME_CHARS = 100;
export const MAX_MESSAGE_CHARS = 1000;
/** Contact requests allowed per visitor per hour, and per session. */
export const CONTACT_LIMIT = 3;
/** Contact requests allowed per UTC day across all visitors. */
export const CONTACT_DAILY_CAP = 50;
const MAX_TOKEN_CHARS = 2048;

type ErrorCode = 'invalid' | 'verify' | 'rate_limited' | 'unavailable';
const STATUS: Record<ErrorCode, number> = { invalid: 400, verify: 401, rate_limited: 429, unavailable: 503 };

function json(body: object, status: number, setCookie?: string): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (setCookie) headers.set('Set-Cookie', setCookie);
  return Response.json(body, { status, headers });
}

const errorResponse = (error: ErrorCode, setCookie?: string): Response => json({ error }, STATUS[error], setCookie);

export interface ContactRequest {
  email: string;
  name?: string;
  message?: string;
  turnstileToken?: string;
}

// C0 controls, DEL and C1 controls. The message may keep \n; nothing else may.
// The name and email also may not hold line/paragraph separators or bidi
// embeddings, overrides and isolates (U+2028-2029, U+202A-202E, U+2066-2069).
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
/** One plain `local@domain.tld` address: no spaces, list separators, quotes, comments or angle brackets. */
const EMAIL_SHAPE = /^[^\s@,;<>()"]+@[^\s@.,;<>()"]+(\.[^\s@.,;<>()"]+)+$/;

/** An optional text field: absent, or a string that is trimmed (blank → absent). Null if invalid. */
function optional(value: unknown, max: number, control: RegExp): { value?: string } | null {
  if (value === undefined) return {};
  if (typeof value !== 'string') return null;
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text.length > max || control.test(text)) return null;
  return text === '' ? {} : { value: text };
}

/**
 * Validates a contact request: `email` required (trimmed, at most 254 chars,
 * `local@domain.tld`), `name` at most 100 chars on one line, `message` at most
 * 1000 chars (newlines allowed, CRLF normalised), no other control characters.
 */
export function parseContactRequest(body: unknown): ContactRequest | { error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'body must be an object' };
  const raw = body as Record<string, unknown>;

  if (typeof raw.email !== 'string') return { error: 'email required' };
  const email = raw.email.trim();
  if (email.length > MAX_EMAIL_CHARS || CONTROL.test(email) || !EMAIL_SHAPE.test(email)) return { error: 'bad email' };

  const name = optional(raw.name, MAX_NAME_CHARS, CONTROL);
  if (!name) return { error: 'bad name' };
  const message = optional(raw.message, MAX_MESSAGE_CHARS, CONTROL_EXCEPT_NEWLINE);
  if (!message) return { error: 'bad message' };

  const { turnstileToken } = raw;
  if (turnstileToken !== undefined && (typeof turnstileToken !== 'string' || turnstileToken === '' || turnstileToken.length > MAX_TOKEN_CHARS)) {
    return { error: 'bad turnstile token' };
  }

  const parsed: ContactRequest = { email };
  if (name.value) parsed.name = name.value;
  if (message.value) parsed.message = message.value;
  if (turnstileToken !== undefined) parsed.turnstileToken = turnstileToken;
  return parsed;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : 'unknown');

/**
 * POST /api/contact: a visitor leaves an email (plus optional name and
 * message) for Plamen to reply to. Order: config → validate → session or
 * Turnstile (exactly as the chat; a pass issues the session cookie) → rate
 * (3 per visitor per hour, 3 per session, 50 per UTC day in all) → send to
 * Telegram, awaited.
 *
 * 200 `{ok:true}` only once Telegram has accepted the message; if Telegram is
 * unconfigured or fails, 503 `unavailable`, so the visitor is never told it was
 * sent when it was not. The request is not stored, and the IP is only hashed
 * for the rate bucket and passed to Turnstile's siteverify.
 *
 * If `waitUntil` is given, pruning old rate buckets is handed to it.
 */
export async function handleContact(
  request: Request,
  env: Env,
  now: Date,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const hostnames = parseHostnames(env.TURNSTILE_HOSTNAMES);
  if (!env.TURNSTILE_SECRET || !env.SESSION_SECRET || !env.DB || hostnames.length === 0) return errorResponse('unavailable');
  if (!env.TELEGRAM_BOT_TOKEN?.trim() || !env.TELEGRAM_CHAT_ID?.trim()) return errorResponse('unavailable');

  // 1. Validate.
  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_CONTACT_BODY_BYTES) return errorResponse('invalid');
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_CONTACT_BODY_BYTES) return errorResponse('invalid');
    body = JSON.parse(raw);
  } catch {
    return errorResponse('invalid');
  }
  const parsed = parseContactRequest(body);
  if ('error' in parsed) return errorResponse('invalid');

  // 2. Session, or Turnstile (which issues a new session).
  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const nowMs = now.getTime();
  let session = readSessionCookie(request.headers.get('Cookie'));
  let setCookie: string | undefined;
  if (!verifySession(env.SESSION_SECRET, session, nowMs)) {
    if (!parsed.turnstileToken || !(await verifyTurnstile(env.TURNSTILE_SECRET, parsed.turnstileToken, ip, hostnames))) {
      return errorResponse('verify');
    }
    session = issueSession(env.SESSION_SECRET, nowMs);
    setCookie = sessionCookie(session);
  }

  // 3. Rate limit, in buckets separate from the chat's. The per-visitor bucket
  // is hourly; the per-session bucket lasts until the session expires (its key
  // ends with the expiry hour, so pruneRate removes it only after that).
  try {
    const sessionExpiry = new Date(Number(session!.split('.')[0]) * 1000);
    const visitorOk = await checkAndCountRate(
      env.DB,
      `contact:${rateBucket(await visitorHash(ip, env.SESSION_SECRET, dayKey(now)), now)}`,
      CONTACT_LIMIT,
    );
    const sessionOk = await checkAndCountRate(
      env.DB,
      `contact:${await sessionHash(session!, env.SESSION_SECRET)}:${hourKey(sessionExpiry)}`,
      CONTACT_LIMIT,
    );
    if (!visitorOk || !sessionOk) return errorResponse('rate_limited', setCookie);
    // Global daily cap, counted only for requests within the per-visitor limits.
    // The key ends with the day's last hour (`YYYY-MM-DDT23`), so pruneRate keeps it all day.
    if (!(await checkAndCountRate(env.DB, `contact:day:${dayKey(now)}T23`, CONTACT_DAILY_CAP))) {
      return errorResponse('rate_limited', setCookie);
    }
  } catch (err) {
    console.error('contact: D1 error', errText(err));
    return errorResponse('unavailable', setCookie);
  }

  const pruned = pruneRate(env.DB, now).catch((err) => console.error('contact: prune failed', errText(err)));
  if (waitUntil) waitUntil(pruned);
  else await pruned;

  // 4. Deliver, and report whether it was delivered.
  const sent = await notifyContact(env, {
    email: parsed.email,
    name: parsed.name,
    message: parsed.message,
    host: new URL(request.url).host,
    now,
  });
  if (!sent) return errorResponse('unavailable', setCookie);
  return json({ ok: true }, 200, setCookie);
}
