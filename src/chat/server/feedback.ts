import { isSameOrigin } from './clicks';
import { dayKey, type Env } from './env';
import { checkAndCountRate, rateBucket, visitorHash } from './limits';
import { cutoffIso } from './log';
import { notifyFeedback } from './notify';
import { readSessionCookie, verifySession } from './session';

export const MAX_FEEDBACK_BODY_BYTES = 32 * 1024;
export const MAX_FEEDBACK_QUESTION_CHARS = 600;
export const MAX_FEEDBACK_ANSWER_CHARS = 6000;
/** Ratings accepted per visitor per hour. */
export const FEEDBACK_LIMIT = 20;

export interface FeedbackRequest {
  vote: 'up' | 'down';
  question: string;
  answer: string;
}

const empty = (status: number): Response => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

const errText = (err: unknown): string => (err instanceof Error ? err.message : 'unknown');

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max ? value : null;

export function parseFeedbackRequest(body: unknown): FeedbackRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const question = text(raw.question, MAX_FEEDBACK_QUESTION_CHARS);
  const answer = text(raw.answer, MAX_FEEDBACK_ANSWER_CHARS);
  if ((raw.vote !== 'up' && raw.vote !== 'down') || !question || !answer) return null;
  return { vote: raw.vote, question, answer };
}

/**
 * POST /api/feedback: a visitor rates an answer they got. Order: config → same
 * origin → validate → valid chat session → rate (20 per visitor per hour) →
 * store for 30 days. A "not helpful" also goes to Telegram.
 *
 * 204 on success, with no body. The text comes from the visitor's browser, so it
 * is a report, not a record of what the model said.
 *
 * If `waitUntil` is given, the Telegram message is handed to it.
 */
export async function handleFeedback(
  request: Request,
  env: Env,
  now: Date,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  if (!env.SESSION_SECRET || !env.DB) return empty(503);
  if (!isSameOrigin(request)) return empty(403);

  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_FEEDBACK_BODY_BYTES) return empty(400);
  let parsed: FeedbackRequest | null;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_FEEDBACK_BODY_BYTES) return empty(400);
    parsed = parseFeedbackRequest(JSON.parse(raw));
  } catch {
    return empty(400);
  }
  if (!parsed) return empty(400);

  if (!verifySession(env.SESSION_SECRET, readSessionCookie(request.headers.get('Cookie')), now.getTime())) return empty(401);

  try {
    const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
    const visitor = await visitorHash(ip, env.SESSION_SECRET, dayKey(now));
    if (!(await checkAndCountRate(env.DB, `feedback:${rateBucket(visitor, now)}`, FEEDBACK_LIMIT))) return empty(429);
    await env.DB.batch([
      env.DB
        .prepare('INSERT INTO feedback (ts, vote, question, answer) VALUES (?, ?, ?, ?)')
        .bind(now.toISOString(), parsed.vote, parsed.question, parsed.answer),
      env.DB.prepare('DELETE FROM feedback WHERE ts < ?').bind(cutoffIso(now)),
    ]);
  } catch (err) {
    console.error('feedback: D1 error', errText(err));
    return empty(503);
  }

  if (parsed.vote === 'down') {
    const sent = notifyFeedback(env, { question: parsed.question, answer: parsed.answer, host: new URL(request.url).host, now });
    if (waitUntil) waitUntil(sent);
    else await sent;
  }
  return empty(204);
}
