import { env as testEnv } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleContact, onRequest } from '../../functions/api/contact';
import { parseContactRequest } from '../../src/chat/server/contact';
import type { Env } from '../../src/chat/server/env';
import { issueSession } from '../../src/chat/server/session';
import { resetTables } from './helpers';

const db = testEnv.DB;
const IP = '203.0.113.77';
const NOW = new Date('2026-10-31T12:00:00Z');
const TG = { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '42' };

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    ANTHROPIC_API_KEY: 'test-key',
    TURNSTILE_SECRET: 'test-turnstile',
    SESSION_SECRET: 'test-session',
    CHAT_MODEL: 'test-model',
    DAILY_CAP_USD: '1.00',
    MONTHLY_CAP_USD: '10.00',
    RATE_LIMIT_PER_HOUR: '20',
    PRICE_INPUT_PER_MTOK: '1',
    PRICE_OUTPUT_PER_MTOK: '5',
    PRICE_CACHE_READ_PER_MTOK: '0.1',
    PRICE_CACHE_WRITE_PER_MTOK: '1.25',
    TURNSTILE_HOSTNAMES: 'plamen.lynxlake.org, *.plamen-site.pages.dev,localhost',
    ...TG,
    ...overrides,
  };
}

function contactRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://plamen.lynxlake.org/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': IP, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const CONTACT = { email: 'jane@example.com', name: 'Jane', message: 'We have a backend role.\nCan we talk?' };
const cookieFor = (issuedAt: number) => `chat_session=${issueSession('test-session', issuedAt)}`;
const COOKIE = { Cookie: cookieFor(NOW.getTime()) };

let fetchSpy: ReturnType<typeof vi.fn>;
let telegramStatus: number;

const telegramCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('https://api.telegram.org/'));
const turnstileCalls = () => fetchSpy.mock.calls.filter(([url]) => String(url).startsWith('https://challenges.cloudflare.com/'));

beforeEach(async () => {
  await resetTables(db);
  telegramStatus = 200;
  fetchSpy = vi.fn(async (url: string | URL | Request) => {
    if (String(url).startsWith('https://api.telegram.org/')) {
      return Response.json({ ok: telegramStatus === 200 }, { status: telegramStatus });
    }
    return Response.json({ success: true, hostname: 'plamen.lynxlake.org' });
  });
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('handleContact: auth', () => {
  it('returns 401 verify without a cookie or token, sending nothing', async () => {
    const res = await handleContact(contactRequest(CONTACT), makeEnv(), NOW);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'verify' });
    expect(telegramCalls()).toHaveLength(0);
  });

  it('returns 401 when Turnstile rejects the token or reports a foreign hostname', async () => {
    for (const verdict of [{ success: false }, { success: true, hostname: 'evil.example.com' }]) {
      fetchSpy.mockImplementation(async () => Response.json(verdict));
      const res = await handleContact(contactRequest({ ...CONTACT, turnstileToken: 'tok' }), makeEnv(), NOW);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'verify' });
    }
  });

  it('returns 401 for an expired session cookie without a token', async () => {
    const res = await handleContact(contactRequest(CONTACT, { Cookie: cookieFor(NOW.getTime() - 3 * 3600_000) }), makeEnv(), NOW);
    expect(res.status).toBe(401);
    expect(turnstileCalls()).toHaveLength(0);
  });

  it('accepts a valid Turnstile token and issues the session cookie', async () => {
    const res = await handleContact(contactRequest({ ...CONTACT, turnstileToken: 'good' }), makeEnv(), NOW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const cookie = res.headers.get('Set-Cookie')!;
    expect(cookie).toMatch(/^chat_session=\d+\.[\w-]{43}; HttpOnly; Secure; SameSite=Strict; Path=\/api; Max-Age=7200$/);
    const form = (turnstileCalls()[0]![1] as RequestInit).body as FormData;
    expect(form.get('secret')).toBe('test-turnstile');
    expect(form.get('response')).toBe('good');
    expect(telegramCalls()).toHaveLength(1);
  });

  it('accepts a session cookie without calling Turnstile or re-issuing the cookie', async () => {
    const res = await handleContact(contactRequest(CONTACT, COOKIE), makeEnv(), NOW);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(turnstileCalls()).toHaveLength(0);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('handleContact: validation', () => {
  it.each([
    ['a non-JSON body', 'not json'],
    ['a non-object body', '"jane@example.com"'],
    ['a missing email', { name: 'Jane' }],
    ['an empty email', { email: '   ' }],
    ['an email without a domain dot', { email: 'jane@localhost' }],
    ['an email without an @', { email: 'jane.example.com' }],
    ['an email with spaces', { email: 'jane doe@example.com' }],
    ['an email over 254 chars', { email: `${'a'.repeat(64)}@${'b'.repeat(186)}.com` }],
    ['a non-string email', { email: 42 }],
    ['a name over 100 chars', { email: 'jane@example.com', name: 'n'.repeat(101) }],
    ['a non-string name', { email: 'jane@example.com', name: ['Jane'] }],
    ['a message over 1000 chars', { email: 'jane@example.com', message: 'm'.repeat(1001) }],
    ['a control character in the message', { email: 'jane@example.com', message: 'hi\u0007there' }],
    ['a newline in the name', { email: 'jane@example.com', name: 'Jane\nDoe' }],
    ['a control character in the email', { email: 'ja\u0000ne@example.com' }],
    ['an empty Turnstile token', { email: 'jane@example.com', turnstileToken: '' }],
  ])('returns 400 invalid for %s', async (_name, body) => {
    const res = await handleContact(contactRequest(body, COOKIE), makeEnv(), NOW);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(telegramCalls()).toHaveLength(0);
  });

  it('returns 400 for a body over 8 KB', async () => {
    const big = JSON.stringify({ email: 'jane@example.com', padding: 'x'.repeat(8 * 1024) });
    const res = await handleContact(contactRequest(big, COOKIE), makeEnv(), NOW);
    expect(res.status).toBe(400);
    expect(telegramCalls()).toHaveLength(0);
  });

  it('accepts the limits exactly, trims the email and keeps newlines in the message', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(185)}.com`;
    expect(email.length).toBe(254);
    const parsed = parseContactRequest({ email: `  ${email} `, name: 'n'.repeat(100), message: 'line 1\r\nline 2' + 'm'.repeat(986) });
    expect(parsed).toEqual({ email, name: 'n'.repeat(100), message: 'line 1\nline 2' + 'm'.repeat(986) });
  });

  it('treats blank optional fields as absent', () => {
    expect(parseContactRequest({ email: 'jane@example.com', name: '  ', message: '\n' })).toEqual({ email: 'jane@example.com' });
  });
});

describe('handleContact: rate limit', () => {
  it('allows 3 requests per session per hour, then returns 429', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await handleContact(contactRequest(CONTACT, COOKIE), makeEnv(), NOW);
      expect(res.status, `request ${i + 1}`).toBe(200);
    }
    const res = await handleContact(contactRequest(CONTACT, COOKIE), makeEnv(), NOW);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(telegramCalls()).toHaveLength(3);
  });

  it('limits a visitor to 3 per hour across new sessions', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await handleContact(contactRequest(CONTACT, { Cookie: cookieFor(NOW.getTime() - i * 1000) }), makeEnv(), NOW);
      expect(res.status).toBe(200);
    }
    const res = await handleContact(contactRequest(CONTACT, { Cookie: cookieFor(NOW.getTime() - 9000) }), makeEnv(), NOW);
    expect(res.status).toBe(429);
  });

  it('limits a session to 3 even in the next hour', async () => {
    for (let i = 0; i < 3; i++) expect((await handleContact(contactRequest(CONTACT, COOKIE), makeEnv(), NOW)).status).toBe(200);
    const later = new Date(NOW.getTime() + 61 * 60_000);
    const res = await handleContact(contactRequest(CONTACT, { ...COOKIE, 'CF-Connecting-IP': '198.51.100.9' }), makeEnv(), later);
    expect(res.status).toBe(429);
  });

  it('uses buckets separate from the chat limit and stores no IP', async () => {
    await handleContact(contactRequest(CONTACT, COOKIE), makeEnv(), NOW);
    const rows = (await db.prepare('SELECT bucket, count FROM rate').all<{ bucket: string; count: number }>()).results;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.bucket.startsWith('contact:')).toBe(true);
      expect(row.bucket).not.toContain(IP);
    }
  });
});

describe('handleContact: delivery', () => {
  it('returns 503 when Telegram is not configured, without calling it', async () => {
    const res = await handleContact(contactRequest(CONTACT, COOKIE), makeEnv({ TELEGRAM_BOT_TOKEN: undefined, TELEGRAM_CHAT_ID: undefined }), NOW);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(telegramCalls()).toHaveLength(0);
  });

  it('returns 503 when Telegram does not accept the message', async () => {
    telegramStatus = 502;
    const res = await handleContact(contactRequest(CONTACT, COOKIE), makeEnv(), NOW);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
    expect(telegramCalls()).toHaveLength(1);
  });

  it('returns 503 when Telegram cannot be reached', async () => {
    fetchSpy.mockImplementation(async () => {
      throw new Error('network down');
    });
    const res = await handleContact(contactRequest(CONTACT, COOKIE), makeEnv(), NOW);
    expect(res.status).toBe(503);
  });

  it('returns 503 when the server config is incomplete', async () => {
    const res = await handleContact(contactRequest(CONTACT, COOKIE), makeEnv({ SESSION_SECRET: '' }), NOW);
    expect(res.status).toBe(503);
  });

  it('sends the email, name and message (never the IP) to Telegram', async () => {
    const res = await handleContact(contactRequest(CONTACT, COOKIE), makeEnv(), NOW);
    expect(res.status).toBe(200);
    const [url, init] = telegramCalls()[0]! as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    const text = JSON.parse(init.body as string).text as string;
    expect(text).toContain('📩 Contact request · plamen.lynxlake.org · 2026-10-31 12:00 UTC');
    expect(text).toContain('Email: jane@example.com');
    expect(text).toContain('Name: Jane');
    expect(text).toContain('We have a backend role.\nCan we talk?');
    expect(text).not.toContain(IP);
  });

  it('stores nothing in the questions table and no IP anywhere', async () => {
    await handleContact(contactRequest({ ...CONTACT, turnstileToken: 'good' }), makeEnv(), NOW);
    expect((await db.prepare('SELECT * FROM questions').all()).results).toEqual([]);
    for (const table of ['spend', 'rate', 'questions']) {
      const rows = JSON.stringify((await db.prepare(`SELECT * FROM ${table}`).all()).results);
      expect(rows).not.toContain(IP);
      expect(rows).not.toContain('jane@example.com');
    }
  });

  it('hands rate-bucket pruning to waitUntil when given', async () => {
    const pending: Promise<unknown>[] = [];
    const res = await handleContact(contactRequest(CONTACT, COOKIE), makeEnv(), NOW, (p) => void pending.push(p));
    expect(res.status).toBe(200);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
  });
});

describe('onRequest', () => {
  it('answers 405 to methods other than POST', async () => {
    const res = await onRequest({ request: new Request('https://example.com/api/contact'), env: makeEnv(), waitUntil: () => {} });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('passes POST requests to handleContact', async () => {
    const res = await onRequest({ request: contactRequest(CONTACT, { Cookie: cookieFor(Date.now()) }), env: makeEnv(), waitUntil: () => {} });
    expect(res.status).toBe(200);
  });
});
