import { profile } from '../../data/profile';
import { buildFitPrompt, buildSystemPrompt, wrapJobDescription } from '../systemPrompt';
import { costMicros, type Prices, type Usage } from './cost';
import { dayKey, type Env } from './env';
import { adjustSpend, checkAndCountRate, pruneRate, rateBucket, reserveSpend, sessionHash, visitorHash } from './limits';
import { logQuestion, purgeQuestions } from './log';
import { FIT_MAX_TOKENS, MAX_TOKENS, type ModelClient } from './model';
import { notifyQuestion } from './notify';
import { issueSession, readSessionCookie, sessionCookie, verifySession } from './session';
import { parseHostnames, verifyTurnstile } from './turnstile';
import { parseChatRequest, type ChatMessage } from './validate';

// Deterministic, so it is built once per isolate.
const SYSTEM_PROMPT = buildSystemPrompt(profile);
const FIT_SYSTEM_PROMPT = buildFitPrompt(profile);

/** Job-fit checks allowed per visitor per hour; they also count towards the chat's limits. */
export const FIT_LIMIT = 5;

// Generous upper bound for a valid body (12000 chars of content, JSON-escaped, plus a token).
const MAX_BODY_BYTES = 64 * 1024;

type ErrorCode = 'invalid' | 'verify' | 'rate_limited' | 'unavailable';
const STATUS: Record<ErrorCode, number> = { invalid: 400, verify: 401, rate_limited: 429, unavailable: 503 };

const errorResponse = (error: ErrorCode): Response =>
  Response.json({ error }, { status: STATUS[error], headers: { 'Cache-Control': 'no-store' } });

interface Config {
  prices: Prices;
  dailyCapUsd: number;
  monthlyCapUsd: number;
  ratePerHour: number;
  turnstileHostnames: string[];
}

const num = (v: string | undefined): number => (v === undefined || v.trim() === '' ? NaN : Number(v));
const finite = (v: number): boolean => Number.isFinite(v);

/**
 * Parses the config; null if anything is missing or unusable. Input and output
 * prices must be > 0 (a zero price would disable the spend guard); cache
 * prices may be 0.
 */
function readConfig(env: Env): Config | null {
  if (!env.ANTHROPIC_API_KEY || !env.TURNSTILE_SECRET || !env.SESSION_SECRET || !env.CHAT_MODEL || !env.DB) return null;
  const prices: Prices = {
    input: num(env.PRICE_INPUT_PER_MTOK),
    output: num(env.PRICE_OUTPUT_PER_MTOK),
    cacheRead: num(env.PRICE_CACHE_READ_PER_MTOK),
    cacheWrite: num(env.PRICE_CACHE_WRITE_PER_MTOK),
  };
  const config = {
    prices,
    dailyCapUsd: num(env.DAILY_CAP_USD),
    monthlyCapUsd: num(env.MONTHLY_CAP_USD),
    ratePerHour: num(env.RATE_LIMIT_PER_HOUR),
    turnstileHostnames: parseHostnames(env.TURNSTILE_HOSTNAMES),
  };
  if (config.turnstileHostnames.length === 0) return null;
  if (![prices.input, prices.output].every((v) => finite(v) && v > 0)) return null;
  if (![prices.cacheRead, prices.cacheWrite, config.dailyCapUsd, config.monthlyCapUsd].every((v) => finite(v) && v >= 0)) return null;
  if (!Number.isInteger(config.ratePerHour) || config.ratePerHour < 1) return null;
  return config;
}

const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * Worst-case cost of one request, reserved before the model is called. A token
 * is at least one UTF-8 byte, so bytes (plus per-message overhead) bound the
 * input tokens; every input token is priced at the dearest input rate (a
 * cache write may cost more than plain input); output is the full budget.
 */
export function worstCaseMicros(messages: ChatMessage[], prices: Prices, system = SYSTEM_PROMPT, maxTokens = MAX_TOKENS): number {
  const inputTokens = utf8Bytes(system) + messages.reduce((n, m) => n + utf8Bytes(m.content) + 10, 0) + 50;
  const dearest = Math.max(prices.input, prices.cacheWrite, prices.cacheRead);
  return costMicros({ input_tokens: inputTokens, output_tokens: maxTokens }, { ...prices, input: dearest });
}

const sse = (data: object): string => `data: ${JSON.stringify(data)}\n\n`;
const errText = (err: unknown): string => (err instanceof Error ? err.message : 'unknown');

/**
 * POST /api/chat. With `mode: 'job_fit'` the single message is a job description
 * to compare with the profile: the same path, with its own prompt, a larger
 * answer budget and one more rate limit.
 *
 * Order: config → validate → session or Turnstile → rate
 * (per visitor and per session) → reserve worst-case spend within the caps →
 * log question → stream → settle the reservation after the stream ends, then
 * prune old rate buckets and purge questions older than 30 days.
 *
 * Settlement: completed with known usage → adjust to the actual cost;
 * failure before any text → release the whole reservation; mid-stream failure
 * or client cancel → keep the reservation (it is the worst case).
 *
 * The visitor IP (CF-Connecting-IP) is only hashed for the rate bucket and
 * passed to Turnstile's siteverify; it is never stored or logged. A Turnstile
 * token counts only if siteverify reports a hostname in TURNSTILE_HOSTNAMES.
 *
 * If `waitUntil` is given, settlement is handed to it; otherwise it completes
 * before the stream closes.
 */
export async function handleChat(
  request: Request,
  env: Env,
  model: ModelClient,
  now: Date,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const config = readConfig(env);
  if (!config) return errorResponse('unavailable');

  // 1. Validate.
  if (Number(request.headers.get('Content-Length') ?? '0') > MAX_BODY_BYTES) return errorResponse('invalid');
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return errorResponse('invalid');
    body = JSON.parse(raw);
  } catch {
    return errorResponse('invalid');
  }
  const parsed = parseChatRequest(body);
  if ('error' in parsed) return errorResponse('invalid');
  const { turnstileToken } = parsed;
  const fit = parsed.mode === 'job_fit';
  const question = parsed.messages[parsed.messages.length - 1]!.content;
  const messages: ChatMessage[] = fit ? [{ role: 'user', content: wrapJobDescription(question) }] : parsed.messages;
  const system = fit ? FIT_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const maxTokens = fit ? FIT_MAX_TOKENS : MAX_TOKENS;
  const logged = fit ? `[job-fit check]\n${question}` : question;

  // 2. Session, or Turnstile (which issues a new session).
  const ip = request.headers.get('CF-Connecting-IP') ?? '0.0.0.0';
  const nowMs = now.getTime();
  let session = readSessionCookie(request.headers.get('Cookie'));
  let newSession = false;
  if (!verifySession(env.SESSION_SECRET, session, nowMs)) {
    if (!turnstileToken || !(await verifyTurnstile(env.TURNSTILE_SECRET, turnstileToken, ip, config.turnstileHostnames))) return errorResponse('verify');
    session = issueSession(env.SESSION_SECRET, nowMs);
    newSession = true;
  }

  const reserved = worstCaseMicros(messages, config.prices, system, maxTokens);
  try {
    // 3. Rate limit per hour: per visitor (IPv6 by /64) and per session; both are counted.
    const visitor = await visitorHash(ip, env.SESSION_SECRET, dayKey(now));
    const visitorOk = await checkAndCountRate(env.DB, rateBucket(visitor, now), config.ratePerHour);
    const sessionOk = await checkAndCountRate(
      env.DB,
      rateBucket(await sessionHash(session!, env.SESSION_SECRET), now),
      config.ratePerHour,
    );
    if (!visitorOk || !sessionOk) return errorResponse('rate_limited');
    if (fit && !(await checkAndCountRate(env.DB, `fit:${rateBucket(visitor, now)}`, Number(env.FIT_LIMIT_PER_HOUR) || FIT_LIMIT))) return errorResponse('rate_limited');

    // 4. Reserve the worst case within the caps.
    if (!(await reserveSpend(env.DB, now, reserved, config.dailyCapUsd, config.monthlyCapUsd))) {
      return errorResponse('unavailable');
    }
  } catch (err) {
    console.error('chat: D1 error', errText(err));
    return errorResponse('unavailable');
  }

  // 5. Log the question. On failure, release the reservation.
  try {
    await logQuestion(env.DB, now, logged);
  } catch (err) {
    console.error('chat: D1 error', errText(err));
    await adjustSpend(env.DB, now, -reserved).catch(() => {});
    return errorResponse('unavailable');
  }
  const notified = notifyQuestion(env, {
    question: logged,
    host: new URL(request.url).host,
    newVisitor: newSession,
    now,
  });
  if (waitUntil) waitUntil(notified);

  // 6. Stream. The reservation is settled once the stream has ended, however it ends.
  type Outcome = 'completed' | 'prestream_failure' | 'kept';
  let settle!: (outcome: Outcome) => void;
  const ended = new Promise<Outcome>((resolve) => (settle = resolve));
  let usage: Promise<Usage> = Promise.reject(new Error('model not called'));
  usage.catch(() => {});

  const settlement = ended
    .then(async (outcome) => {
      if (outcome === 'prestream_failure') return -reserved;
      if (outcome === 'kept') return 0;
      try {
        return costMicros(await usage, config.prices) - reserved;
      } catch {
        return 0; // usage unknown: keep the worst case
      }
    })
    .then((delta) => adjustSpend(env.DB, now, delta))
    .then(() => pruneRate(env.DB, now))
    .then(() => purgeQuestions(env.DB, now))
    .catch((err) => console.error('chat: spend settlement failed', errText(err)));
  if (waitUntil) waitUntil(settlement);

  let iterator: AsyncIterator<string>;
  let first: IteratorResult<string>;
  try {
    const result = model.stream(system, messages, maxTokens);
    usage = result.usage;
    usage.catch(() => {});
    iterator = result.text[Symbol.asyncIterator]();
    first = await iterator.next();
  } catch (err) {
    console.error('chat: model error before streaming', errText(err));
    settle('prestream_failure');
    if (!waitUntil) await settlement;
    return errorResponse('unavailable');
  }

  const encoder = new TextEncoder();
  let sawText = false;
  const finish = async (controller: ReadableStreamDefaultController<Uint8Array>, outcome: Outcome) => {
    settle(outcome);
    if (!waitUntil) await settlement;
    // A completed stream with no text at all is a failure for the visitor: never send an empty `done`.
    const ok = outcome === 'completed' && sawText;
    if (outcome === 'completed' && !sawText) console.error('chat: model completed with no text');
    controller.enqueue(encoder.encode(sse({ type: ok ? 'done' : 'error' })));
    controller.close();
  };

  let next: IteratorResult<string> | null = first;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = next ?? (await iterator.next());
        next = null;
        if (chunk.done) return await finish(controller, 'completed');
        if (chunk.value !== '') sawText = true;
        controller.enqueue(encoder.encode(sse({ type: 'delta', text: chunk.value })));
      } catch (err) {
        // Mid-stream failure: send an error event (never `done`) and close.
        console.error('chat: model error while streaming', errText(err));
        await finish(controller, 'kept');
      }
    },
    async cancel() {
      // Client went away: keep the worst-case reservation and stop the model.
      settle('kept');
      try {
        await iterator.return?.();
      } catch {
        // ignore
      }
    },
  });

  const headers = new Headers({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (newSession) headers.set('Set-Cookie', sessionCookie(session!));
  return new Response(stream, { status: 200, headers });
}
