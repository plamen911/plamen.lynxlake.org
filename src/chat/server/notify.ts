// Optional Telegram message for each chat question, so Plamen sees what
// visitors ask without querying D1. Sends the question text, host and time
// only (never the IP), and never affects the chat's own response.

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

/** Posts the question to the configured Telegram chat. No-op when unconfigured; errors are logged, never thrown. */
export async function notifyQuestion(config: NotifyConfig, notice: QuestionNotice, fetchFn: typeof fetch = fetch): Promise<void> {
  const token = config.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = config.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) return;

  const question =
    notice.question.length > MAX_NOTIFY_CHARS ? notice.question.slice(0, MAX_NOTIFY_CHARS) + '…' : notice.question;
  const time = notice.now.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const text = `💬 ${notice.host} · ${notice.newVisitor ? 'new visitor' : 'follow-up'} · ${time}\n\n${question}`;

  try {
    const res = await fetchFn(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.error('chat: telegram notify failed', res.status);
  } catch (err) {
    console.error('chat: telegram notify failed', err instanceof Error ? err.message : String(err));
  }
}
