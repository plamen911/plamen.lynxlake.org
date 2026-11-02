// Optional Telegram messages: one per chat question, so Plamen sees what
// visitors ask without querying D1 (question text, host and time only, never
// the IP; never affects the chat's response), and contact requests left by
// visitors (see contact.ts), whose delivery the caller awaits and reports.

export const MAX_NOTIFY_CHARS = 1000;

export interface NotifyConfig {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

export interface QuestionNotice {
  question: string;
  host: string;
  /** True when this request started a new chat session (Turnstile was solved). */
  newVisitor: boolean;
  now: Date;
}

/** Telegram must answer within this time, or the send counts as failed. */
export const TELEGRAM_TIMEOUT_MS = 8000;

export type SendResult = 'sent' | 'unconfigured' | 'failed';

/**
 * Posts plain text (no parse_mode) to the configured Telegram chat. Never
 * throws: reports `unconfigured` when the token or chat id is missing, and
 * `failed` (after logging) when Telegram does not accept the message or does
 * not answer within `timeoutMs`.
 */
export async function sendTelegram(
  config: NotifyConfig,
  text: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = TELEGRAM_TIMEOUT_MS,
): Promise<SendResult> {
  const token = config.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = config.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return 'unconfigured';
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.ok) return 'sent';
    console.error('chat: telegram send failed', res.status);
  } catch (err) {
    console.error('chat: telegram send failed', err instanceof Error ? err.message : String(err));
  }
  return 'failed';
}

const utcMinute = (now: Date): string => now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** Posts the question to the configured Telegram chat. No-op when unconfigured; errors are logged, never thrown. */
export async function notifyQuestion(config: NotifyConfig, notice: QuestionNotice, fetchFn: typeof fetch = fetch): Promise<void> {
  const question =
    notice.question.length > MAX_NOTIFY_CHARS ? notice.question.slice(0, MAX_NOTIFY_CHARS) + '…' : notice.question;
  const text = `💬 ${notice.host} · ${notice.newVisitor ? 'new visitor' : 'follow-up'} · ${utcMinute(notice.now)}\n\n${question}`;
  await sendTelegram(config, text, fetchFn);
}

export interface FeedbackNotice {
  question: string;
  answer: string;
  host: string;
  now: Date;
}

/** Posts an answer a visitor marked as not helpful. No-op when unconfigured; errors are logged, never thrown. */
export async function notifyFeedback(config: NotifyConfig, notice: FeedbackNotice, fetchFn: typeof fetch = fetch): Promise<void> {
  const cut = (s: string): string => (s.length > MAX_NOTIFY_CHARS ? s.slice(0, MAX_NOTIFY_CHARS) + '…' : s);
  const text = `👎 Not helpful · ${notice.host} · ${utcMinute(notice.now)}\n\nQ: ${cut(notice.question)}\n\nA: ${cut(notice.answer)}`;
  await sendTelegram(config, text, fetchFn);
}

export interface ContactNotice {
  email: string;
  name?: string;
  message?: string;
  host: string;
  now: Date;
}

/**
 * Sends a visitor's contact request (email, optional name and message; never
 * the IP) to the Telegram chat. True only if Telegram accepted it. The fields
 * are validated and length-limited by the caller.
 */
export async function notifyContact(config: NotifyConfig, notice: ContactNotice, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const lines = [`📩 Contact request · ${notice.host} · ${utcMinute(notice.now)}`, '', `Email: ${notice.email}`];
  if (notice.name) lines.push(`Name: ${notice.name}`);
  if (notice.message) lines.push('', notice.message);
  return (await sendTelegram(config, lines.join('\n'), fetchFn)) === 'sent';
}
