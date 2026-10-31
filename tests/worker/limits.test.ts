import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  adjustSpend,
  checkAndCountRate,
  rateKeyForIp,
  reserveSpend,
  sessionHash,
  visitorHash,
} from '../../src/chat/server/limits';
import { logQuestion } from '../../src/chat/server/log';
import { resetTables } from './helpers';

const db = env.DB;

beforeEach(() => resetTables(db));

describe('visitorHash', () => {
  it('is a stable hex digest that does not contain the IP and changes per day and secret', async () => {
    const a = await visitorHash('203.0.113.7', 's', '2026-10-31');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('203.0.113.7');
    expect(await visitorHash('203.0.113.7', 's', '2026-10-31')).toBe(a);
    expect(await visitorHash('203.0.113.7', 's', '2026-11-01')).not.toBe(a);
    expect(await visitorHash('203.0.113.7', 't', '2026-10-31')).not.toBe(a);
  });
});

describe('rateKeyForIp / IPv6 /64', () => {
  it('keeps IPv4 and reduces IPv6 to a normalised /64 prefix', () => {
    expect(rateKeyForIp('203.0.113.7')).toBe('203.0.113.7');
    expect(rateKeyForIp('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(rateKeyForIp('2001:0DB8:0001:0002:ffff:0:0:9')).toBe('2001:db8:1:2::/64');
    expect(rateKeyForIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(rateKeyForIp('::1')).toBe('0:0:0:0::/64');
    expect(rateKeyForIp('::ffff:198.51.100.4')).toBe('198.51.100.4');
  });

  it('gives addresses in the same /64 the same visitor hash, and other /64s a different one', async () => {
    const a = await visitorHash('2001:db8:1:2::1', 's', '2026-10-31');
    expect(await visitorHash('2001:db8:1:2:aaaa:bbbb:cccc:dddd', 's', '2026-10-31')).toBe(a);
    expect(await visitorHash('2001:db8:1:3::1', 's', '2026-10-31')).not.toBe(a);
  });

  it('hashes sessions separately from visitors', async () => {
    const h = await sessionHash('123.abc', 's');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sessionHash('123.abd', 's')).not.toBe(h);
  });
});

describe('checkAndCountRate', () => {
  it('allows 20 requests in a bucket and blocks the 21st', async () => {
    for (let i = 0; i < 20; i++) expect(await checkAndCountRate(db, 'v:2026-10-31T12', 20)).toBe(true);
    expect(await checkAndCountRate(db, 'v:2026-10-31T12', 20)).toBe(false);
    expect(await checkAndCountRate(db, 'v:2026-10-31T13', 20)).toBe(true);
  });
});

describe('spend reservation', () => {
  const today = new Date('2026-10-31T12:00:00Z');
  const rows = async () =>
    (await db.prepare('SELECT period, usd_micros FROM spend ORDER BY period').all<{ period: string; usd_micros: number }>()).results;

  it('reserves up to the daily cap exactly, then refuses; the next day is allowed again', async () => {
    expect(await reserveSpend(db, today, 1_000_000, 1, 10)).toBe(true);
    expect(await reserveSpend(db, today, 1, 1, 10)).toBe(false);
    expect(await rows()).toEqual([
      { period: '2026-10', usd_micros: 1_000_000 },
      { period: '2026-10-31', usd_micros: 1_000_000 },
    ]);
    expect(await reserveSpend(db, new Date('2026-11-01T00:00:01Z'), 1, 1, 10)).toBe(true);
  });

  it('adjusts both the day and the month row, never below zero', async () => {
    await reserveSpend(db, today, 3000, 1, 10);
    await adjustSpend(db, today, -2500);
    expect(await rows()).toEqual([
      { period: '2026-10', usd_micros: 500 },
      { period: '2026-10-31', usd_micros: 500 },
    ]);
    await adjustSpend(db, today, -10_000);
    expect((await rows()).map((r) => r.usd_micros)).toEqual([0, 0]);
  });

  it('blocks once the month row reaches the monthly cap and rolls back the day reservation', async () => {
    for (let day = 1; day <= 10; day++) {
      expect(await reserveSpend(db, new Date(Date.UTC(2026, 9, day, 12)), 1_000_000, 1, 10)).toBe(true);
    }
    const d20 = new Date('2026-10-20T12:00:00Z');
    expect(await reserveSpend(db, d20, 1, 1, 10)).toBe(false);
    const day20 = await db.prepare('SELECT usd_micros FROM spend WHERE period = ?').bind('2026-10-20').first();
    expect(day20).toEqual({ usd_micros: 0 });
    const month = await db.prepare('SELECT usd_micros FROM spend WHERE period = ?').bind('2026-10').first();
    expect(month).toEqual({ usd_micros: 10_000_000 });
    expect(await reserveSpend(db, new Date('2026-11-01T12:00:00Z'), 1_000_000, 1, 10)).toBe(true);
  });

  it('rolls back the month reservation when the day cap refuses', async () => {
    await reserveSpend(db, today, 900_000, 1, 10);
    expect(await reserveSpend(db, today, 200_000, 1, 10)).toBe(false);
    expect((await rows()).map((r) => r.usd_micros)).toEqual([900_000, 900_000]);
  });
});

describe('logQuestion', () => {
  it('stores the question and deletes rows older than 30 days', async () => {
    await logQuestion(db, new Date('2026-09-01T00:00:00Z'), 'old');
    await logQuestion(db, new Date('2026-10-31T12:00:00Z'), 'new');
    const rows = await db.prepare('SELECT ts, question FROM questions').all();
    expect(rows.results).toEqual([{ ts: '2026-10-31T12:00:00.000Z', question: 'new' }]);
  });
});
