import { env as testEnv } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleStats, onRequest } from '../../functions/api/stats';
import { STATS_DAYS } from '../../src/chat/server/stats';
import type { Env } from '../../src/chat/server/env';
import { resetTables } from './helpers';

const db = testEnv.DB;
const NOW = new Date('2026-11-08T12:00:00Z');
const env = { DB: db } as Env;

beforeEach(async () => {
  await resetTables(db);
  await db.batch([
    db.prepare("INSERT INTO clicks (day, link, count) VALUES ('2026-11-08', 'view', 5), ('2026-11-08', 'cv', 2), ('2026-11-07', 'mcp-go-checker:npmjs', 3), ('2026-11-07', 'mcp-go-checker:github', 1), ('2026-09-01', 'cv', 9)"),
    db.prepare("INSERT INTO questions (ts, question) VALUES ('2026-11-08T10:00:00Z', 'secret question text'), ('2026-11-08T11:00:00Z', 'another')"),
    db.prepare("INSERT INTO feedback (ts, vote, question, answer) VALUES ('2026-11-07T09:00:00Z', 'up', 'q', 'a'), ('2026-11-07T09:30:00Z', 'down', 'q', 'a')"),
  ]);
});

describe('GET /api/stats', () => {
  it('returns totals per day for the last 30 days, counts only', async () => {
    const res = await handleStats(env, NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    const text = await res.text();
    expect(text).not.toContain('secret question text');
    const body = JSON.parse(text);
    expect(body.daily).toHaveLength(STATS_DAYS);
    expect(body.daily.at(-1)).toMatchObject({ day: '2026-11-08', views: 5, cv: 2, chat: 2 });
    expect(body.daily.at(-2)).toMatchObject({ day: '2026-11-07', projects: 4, rated_up: 1, rated_down: 1 });
    expect(body.totals).toMatchObject({ views: 5, cv: 2, projects: 4, chat: 2, rated_up: 1, rated_down: 1 });
  });

  it('answers 405 to anything but GET', async () => {
    const res = await onRequest({ request: new Request('https://plamen.lynxlake.org/api/stats', { method: 'POST' }), env });
    expect(res.status).toBe(405);
  });
});
