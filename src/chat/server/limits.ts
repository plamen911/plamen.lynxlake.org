import { dayKey, hourKey, monthKey, type D1Database } from './env';

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The part of an IP address that identifies a visitor for rate limiting.
 * IPv4 is used whole. IPv6 is reduced to its /64 prefix (normalised), since a
 * single client usually controls a whole /64 and could rotate within it.
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is treated as the IPv4 address.
 */
export function rateKeyForIp(ip: string): string {
  if (!ip.includes(':')) return ip;
  const addr = ip.toLowerCase().split('%')[0]!;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr);
  if (mapped) return mapped[1]!;
  const halves = addr.split('::');
  if (halves.length > 2) return addr;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return addr;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return addr;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

async function hmacHex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}

/**
 * HMAC-SHA-256 of the visitor's IP key (see rateKeyForIp), keyed with the
 * secret and the day, so hashes cannot be reversed by brute-forcing the IP
 * space or linked across days. The IP itself is never stored.
 */
export function visitorHash(ip: string, secret: string, day: string): Promise<string> {
  return hmacHex(`${secret}:${day}`, rateKeyForIp(ip));
}

/** HMAC-SHA-256 of a session cookie value, for the per-session rate bucket. */
export function sessionHash(sessionValue: string, secret: string): Promise<string> {
  return hmacHex(`${secret}:session-bucket`, sessionValue);
}

export const rateBucket = (hash: string, now: Date): string => `${hash}:${hourKey(now)}`;

/** Counts one request in the bucket atomically; true while the count is within the limit. */
export async function checkAndCountRate(db: D1Database, bucket: string, limit: number): Promise<boolean> {
  const row = await db
    .prepare('INSERT INTO rate (bucket, count) VALUES (?, 1) ON CONFLICT (bucket) DO UPDATE SET count = count + 1 RETURNING count')
    .bind(bucket)
    .first<{ count: number }>();
  return row !== null && row.count <= limit;
}

/** Deletes rate buckets from earlier hours (the bucket ends with `YYYY-MM-DDTHH`). */
export async function pruneRate(db: D1Database, now: Date): Promise<void> {
  await db.prepare('DELETE FROM rate WHERE substr(bucket, -13) < ?').bind(hourKey(now)).run();
}

const usdToMicros = (usd: number): number => Math.round(usd * 1_000_000);

const RESERVE =
  'UPDATE spend SET usd_micros = usd_micros + ?1 WHERE period = ?2 AND usd_micros + ?1 <= ?3 RETURNING usd_micros';
const ADJUST = 'UPDATE spend SET usd_micros = max(0, usd_micros + ?1) WHERE period = ?2';

/**
 * Atomically reserves `micros` in both today's and this month's row, but only
 * where the new total stays within the cap. If either period would exceed its
 * cap, the other's reservation is rolled back and false is returned.
 */
export async function reserveSpend(
  db: D1Database,
  now: Date,
  micros: number,
  dailyCapUsd: number,
  monthlyCapUsd: number,
): Promise<boolean> {
  const day = dayKey(now);
  const month = monthKey(now);
  const init = 'INSERT OR IGNORE INTO spend (period, usd_micros) VALUES (?, 0)';
  const results = await db.batch([
    db.prepare(init).bind(day),
    db.prepare(init).bind(month),
    db.prepare(RESERVE).bind(micros, day, usdToMicros(dailyCapUsd)),
    db.prepare(RESERVE).bind(micros, month, usdToMicros(monthlyCapUsd)),
  ]);
  const dayOk = results[2]!.results.length > 0;
  const monthOk = results[3]!.results.length > 0;
  if (dayOk && monthOk) return true;
  const rollback = [];
  if (dayOk) rollback.push(db.prepare(ADJUST).bind(-micros, day));
  if (monthOk) rollback.push(db.prepare(ADJUST).bind(-micros, month));
  if (rollback.length) await db.batch(rollback);
  return false;
}

/** Adds `deltaMicros` (may be negative) to both today's and this month's row. */
export async function adjustSpend(db: D1Database, now: Date, deltaMicros: number): Promise<void> {
  if (deltaMicros === 0) return;
  await db.batch([db.prepare(ADJUST).bind(deltaMicros, dayKey(now)), db.prepare(ADJUST).bind(deltaMicros, monthKey(now))]);
}
