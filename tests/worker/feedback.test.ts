import { env as testEnv } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFeedback, onRequest } from '../../functions/api/feedback';
import type { Env } from '../../src/chat/server/env';
import { FEEDBACK_LIMIT, MAX_FEEDBACK_ANSWER_CHARS } from '../../src/chat/server/feedback';
import { issueSession } from '../../src/chat/server/session';
import { resetTables } from './helpers';

const db = testEnv.DB;
const NOW = new Date('2026-11-02T12:00:00Z');
const ORIGIN = 'https://plamen.lynxlake.org';
const VOTE = { vote: 'down', question: 'Is he available?', answer: 'Yes. (see #contact)' };
const TG = { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '42' };

const makeEnv = (overrides: Partial<Env> = {}): Env => ({ DB: db, SESSION_SECRET: 'test-session', ...overrides }) as Env;

function feedbackRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/feedback`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.77', Cookie: `chat_session=${issueSession('test-session', NOW.getTime())}`, ...headers },
    body: JSON.stringify(body),
  });
}

const rows = async () => (await db.prepare('SELECT ts, vote, question, answer FROM feedback').all()).results;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  await resetTables(db);
  fetchSpy = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/feedback', () => {
  it('stores a rating, with no IP, and answers 204', async () => {
    const res = await handleFeedback(feedbackRequest(VOTE), makeEnv(), NOW);
    expect(res.status).toBe(204);
    expect(await rows()).toEqual([{ ts: NOW.toISOString(), ...VOTE }]);
    expect(JSON.stringify(await rows())).not.toContain('203.0.113.77');
  });

  it('sends "not helpful" to Telegram, but not "helpful"', async () => {
    await handleFeedback(feedbackRequest({ ...VOTE, vote: 'up' }), makeEnv(TG), NOW);
    expect(fetchSpy).not.toHaveBeenCalled();
    await handleFeedback(feedbackRequest(VOTE), makeEnv(TG), NOW);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0]![1].body));
    expect(body.text).toContain('Not helpful');
    expect(body.text).toContain(VOTE.question);
    expect(body.text).toContain(VOTE.answer);
  });

  it('refuses a request without a valid session, or from another origin', async () => {
    expect((await handleFeedback(feedbackRequest(VOTE, { Cookie: '' }), makeEnv(), NOW)).status).toBe(401);
    expect((await handleFeedback(feedbackRequest(VOTE, { Origin: 'https://evil.example' }), makeEnv(), NOW)).status).toBe(403);
    expect(await rows()).toEqual([]);
  });

  it('answers 400 to a bad vote, empty text or an overlong answer', async () => {
    for (const body of [{ ...VOTE, vote: 'meh' }, { ...VOTE, question: ' ' }, { ...VOTE, answer: 'x'.repeat(MAX_FEEDBACK_ANSWER_CHARS + 1) }, []]) {
      expect((await handleFeedback(feedbackRequest(body), makeEnv(), NOW)).status).toBe(400);
    }
    expect(await rows()).toEqual([]);
  });

  it('stops at the hourly limit', async () => {
    for (let i = 0; i < FEEDBACK_LIMIT; i++) expect((await handleFeedback(feedbackRequest(VOTE), makeEnv(), NOW)).status).toBe(204);
    expect((await handleFeedback(feedbackRequest(VOTE), makeEnv(), NOW)).status).toBe(429);
  });

  it('deletes ratings older than 30 days', async () => {
    await db.prepare('INSERT INTO feedback (ts, vote, question, answer) VALUES (?, ?, ?, ?)').bind('2026-09-01T00:00:00.000Z', 'up', 'q', 'a').run();
    await handleFeedback(feedbackRequest(VOTE), makeEnv(), NOW);
    expect(await rows()).toHaveLength(1);
  });

  it('answers other methods with 405', async () => {
    const context = { request: new Request(`${ORIGIN}/api/feedback`), env: makeEnv(), waitUntil: () => {} };
    expect((await onRequest(context)).status).toBe(405);
  });
});
