// Bindings and variables of the chat Pages Function. Secrets come from
// `.dev.vars` locally and from Pages secrets in production.

/**
 * The subset of Cloudflare's D1 API that the chat uses. The real
 * `D1Database` is structurally compatible; it is declared here so the code
 * type-checks without the Workers globals (which clash with the DOM lib).
 */
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = Record<string, unknown>>(statements: D1PreparedStatement[]): Promise<{ results: T[] }[]>;
}

export interface Env {
  DB: D1Database;
  ANTHROPIC_API_KEY: string;
  TURNSTILE_SECRET: string;
  SESSION_SECRET: string;
  CHAT_MODEL: string;
  DAILY_CAP_USD: string;
  MONTHLY_CAP_USD: string;
  RATE_LIMIT_PER_HOUR: string;
  /** Optional: job-fit checks per visitor per hour, raised for the eval run; the default is FIT_LIMIT. */
  FIT_LIMIT_PER_HOUR?: string;
  PRICE_INPUT_PER_MTOK: string;
  PRICE_OUTPUT_PER_MTOK: string;
  PRICE_CACHE_READ_PER_MTOK: string;
  PRICE_CACHE_WRITE_PER_MTOK: string;
  /** Comma-separated hostnames a Turnstile token may come from; `*.suffix` allows subdomains. */
  TURNSTILE_HOSTNAMES: string;
  /** Optional: Telegram bot token and chat id for a message per question. Notifications are off when either is unset. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

/** UTC period keys used by the limits and logs. */
export const dayKey = (now: Date): string => now.toISOString().slice(0, 10);
export const monthKey = (now: Date): string => now.toISOString().slice(0, 7);
export const hourKey = (now: Date): string => now.toISOString().slice(0, 13);
