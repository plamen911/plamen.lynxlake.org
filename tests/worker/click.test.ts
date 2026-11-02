import { env as testEnv } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleClick, onRequest } from '../../functions/api/click';
import { CLICK_DAILY_CAP, CLICK_LIMIT, MAX_CLICK_BODY_BYTES, parseClickRequest } from '../../src/chat/server/clicks';
import type { Env } from '../../src/chat/server/env';
import { resetTables } from './helpers';

const db = testEnv.DB;
const IP = '203.0.113.77';
const NOW = new Date('2026-11-02T12:00:00Z');
const ORIGIN = 'https://plamen.lynxlake.org';

const makeEnv = (overrides: Partial<Env> = {}): Env => ({ DB: db, SESSION_SECRET: 'test-session', ...overrides }) as Env;

function clickRequest(body: unknown, headers: Record<string, string> = {}, ip = IP): Request {
  return new Request(`${ORIGIN}/api/click`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const totals = async () => (await db.prepare('SELECT day, link, count FROM clicks ORDER BY link').all()).results;

beforeEach(() => resetTables(db));
afterEach(() => vi.restoreAllMocks());

describe('parseClickRequest', () => {
  it('accepts the page links, including project links', () => {
    for (const link of ['cv', 'email', 'linkedin', 'github', 'mcp-go-checker:github', 'mcp-go-checker:npmjs']) {
      expect(parseClickRequest({ link }), link).toBe(link);
    }
  });

  it('refuses anything else', () => {
    for (const body of [null, [], 'cv', {}, { link: 1 }, { link: 'https://evil.example' }, { link: '' }]) {
      expect(parseClickRequest(body)).toBeNull();
    }
  });
});

describe('POST /api/click', () => {
  it('counts per link and per day, with no body or cookie', async () => {
    const first = await handleClick(clickRequest({ link: 'cv' }), makeEnv(), NOW);
    expect(first.status).toBe(204);
    expect(await first.text()).toBe('');
    expect(first.headers.get('Set-Cookie')).toBeNull();
    await handleClick(clickRequest({ link: 'cv' }), makeEnv(), NOW);
    await handleClick(clickRequest({ link: 'github' }), makeEnv(), NOW);
    await handleClick(clickRequest({ link: 'cv' }), makeEnv(), new Date('2026-11-03T00:00:00Z'));
    const rows = await totals();
    expect(rows).toContainEqual({ day: '2026-11-02', link: 'cv', count: 2 });
    expect(rows).toContainEqual({ day: '2026-11-02', link: 'github', count: 1 });
    expect(rows).toContainEqual({ day: '2026-11-03', link: 'cv', count: 1 });
  });

  it('stores no IP address', async () => {
    await handleClick(clickRequest({ link: 'cv' }), makeEnv(), NOW);
    const dump = JSON.stringify([await totals(), (await db.prepare('SELECT bucket FROM rate').all()).results]);
    expect(dump).not.toContain(IP);
  });

  it('refuses a missing, malformed or foreign Origin', async () => {
    for (const origin of [undefined, 'not a url', 'https://evil.example']) {
      const request = new Request(`${ORIGIN}/api/click`, {
        method: 'POST',
        headers: origin ? { Origin: origin } : {},
        body: JSON.stringify({ link: 'cv' }),
      });
      expect((await handleClick(request, makeEnv(), NOW)).status, String(origin)).toBe(403);
    }
    expect(await totals()).toEqual([]);
  });

  it('answers 400 to bad JSON, an unknown link or an oversized body', async () => {
    for (const body of ['{', { link: 'nope' }, JSON.stringify({ link: 'cv', pad: 'x'.repeat(MAX_CLICK_BODY_BYTES) })]) {
      expect((await handleClick(clickRequest(body), makeEnv(), NOW)).status).toBe(400);
    }
    expect(await totals()).toEqual([]);
  });

  it('stops counting a visitor over the hourly limit, but not other visitors', async () => {
    for (let i = 0; i < CLICK_LIMIT; i++) {
      expect((await handleClick(clickRequest({ link: 'cv' }), makeEnv(), NOW)).status).toBe(204);
    }
    expect((await handleClick(clickRequest({ link: 'cv' }), makeEnv(), NOW)).status).toBe(429);
    expect(await totals()).toEqual([{ day: '2026-11-02', link: 'cv', count: CLICK_LIMIT }]);
    expect((await handleClick(clickRequest({ link: 'cv' }, {}, '203.0.113.78'), makeEnv(), NOW)).status).toBe(204);
  });

  it('stops counting at the daily cap', async () => {
    await db.prepare('INSERT INTO rate (bucket, count) VALUES (?, ?)').bind('click:day:2026-11-02T23', CLICK_DAILY_CAP).run();
    expect((await handleClick(clickRequest({ link: 'cv' }), makeEnv(), NOW)).status).toBe(429);
    expect(await totals()).toEqual([]);
  });

  it('answers 503 when unconfigured or when D1 fails', async () => {
    expect((await handleClick(clickRequest({ link: 'cv' }), makeEnv({ SESSION_SECRET: '' }), NOW)).status).toBe(503);
    const broken = { prepare: () => { throw new Error('D1 down'); } } as unknown as Env['DB'];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await handleClick(clickRequest({ link: 'cv' }), makeEnv({ DB: broken }), NOW)).status).toBe(503);
  });

  it('answers other methods with 405', async () => {
    const context = { request: new Request(`${ORIGIN}/api/click`), env: makeEnv(), waitUntil: () => {} };
    const response = await onRequest(context);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
});
