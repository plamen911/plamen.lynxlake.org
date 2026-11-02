import { clickKeys } from '../../data/clicks';
import { profile } from '../../data/profile';
import { dayKey, type Env } from './env';
import { checkAndCountRate, pruneRate, rateBucket, visitorHash } from './limits';

export const MAX_CLICK_BODY_BYTES = 256;
/** Clicks counted per visitor per hour. */
export const CLICK_LIMIT = 30;
/** Clicks counted per UTC day across all visitors. */
export const CLICK_DAILY_CAP = 2000;

const ALLOWED = new Set(clickKeys(profile.projects));

const empty = (status: number): Response => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

const errText = (err: unknown): string => (err instanceof Error ? err.message : 'unknown');

/** True if the request's Origin is this site: refuses a missing or malformed one. */
export function isSameOrigin(request: Request): boolean {
  try {
    return new URL(request.headers.get('Origin') ?? '').host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** The link name from a request body, or null unless it is a known one. */
export function parseClickRequest(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const { link } = body as Record<string, unknown>;
  return typeof link === 'string' && ALLOWED.has(link) ? link : null;
}

/**
 * POST /api/click: adds one to today's total for a link on the page. Order:
 * config → same origin → validate → rate (30 per visitor per hour, 2000 per UTC
 * day in all) → count.
 *
 * 204 on success, with no body and no cookie. Only the per-day totals are kept;
 * the IP is only hashed for the hourly rate bucket. There is no Turnstile, since
 * a page beacon cannot pass one, so the totals are a guide, not an audit.
 *
 * If `waitUntil` is given, pruning old rate buckets is handed to it.
 */
export async function handleClick(
  request: Request,
  env: Env,
  now: Date,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  if (!env.SESSION_SECRET || !env.DB) return empty(503);

  if (!isSameOrigin(request)) return empty(403);

  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_CLICK_BODY_BYTES) return empty(400);
  let link: string | null;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_CLICK_BODY_BYTES) return empty(400);
    link = parseClickRequest(JSON.parse(raw));
  } catch {
    return empty(400);
  }
  if (!link) return empty(400);

  try {
    const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
    const day = dayKey(now);
    const visitor = await visitorHash(ip, env.SESSION_SECRET, day);
    if (!(await checkAndCountRate(env.DB, `click:${rateBucket(visitor, now)}`, CLICK_LIMIT))) return empty(429);
    // The key ends with the day's last hour (`YYYY-MM-DDT23`), so pruneRate keeps it all day.
    if (!(await checkAndCountRate(env.DB, `click:day:${day}T23`, CLICK_DAILY_CAP))) return empty(429);
    await env.DB
      .prepare('INSERT INTO clicks (day, link, count) VALUES (?, ?, 1) ON CONFLICT (day, link) DO UPDATE SET count = count + 1')
      .bind(day, link)
      .run();
  } catch (err) {
    console.error('click: D1 error', errText(err));
    return empty(503);
  }

  const pruned = pruneRate(env.DB, now).catch((err) => console.error('click: prune failed', errText(err)));
  if (waitUntil) waitUntil(pruned);
  else await pruned;
  return empty(204);
}
