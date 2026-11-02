export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const MAX_MESSAGES = 12;
export const MAX_USER_CHARS = 600;
export const MAX_ASSISTANT_CHARS = 2000;
export const MAX_TOTAL_CHARS = 12_000;
export const MIN_JOB_CHARS = 40;
export const MAX_JOB_CHARS = 6000;
const MAX_TOKEN_CHARS = 2048; // Turnstile tokens are at most 2048 characters.

export type ChatMode = 'job_fit';

type Parsed = { messages: ChatMessage[]; turnstileToken?: string; mode?: ChatMode } | { error: string };

/**
 * Validates the request body and returns a clean copy (role and content only).
 * 1-12 messages, starting and ending with `user`, roles alternating; user
 * messages at most 600 chars, assistant messages at most 2000, 12000 in total.
 * With `mode: 'job_fit'`, exactly one user message of 40-6000 chars: the job description.
 */
export function parseChatRequest(body: unknown): Parsed {
  if (typeof body !== 'object' || body === null) return { error: 'body must be an object' };
  const { messages, turnstileToken, mode } = body as Record<string, unknown>;

  if (mode !== undefined && mode !== 'job_fit') return { error: 'unknown mode' };
  const maxUserChars = mode === 'job_fit' ? MAX_JOB_CHARS : MAX_USER_CHARS;

  if (!Array.isArray(messages)) return { error: 'messages must be an array' };
  if (messages.length < 1 || messages.length > MAX_MESSAGES) return { error: `1-${MAX_MESSAGES} messages` };

  const clean: ChatMessage[] = [];
  let total = 0;
  for (const [i, m] of messages.entries()) {
    if (typeof m !== 'object' || m === null) return { error: 'message must be an object' };
    const { role, content } = m as Record<string, unknown>;
    const expected: ChatMessage['role'] = i % 2 === 0 ? 'user' : 'assistant';
    if (role !== expected) return { error: 'roles must alternate, starting with user' };
    if (typeof content !== 'string' || content.trim() === '') return { error: 'content must be a non-empty string' };
    if (content.length > (role === 'user' ? maxUserChars : MAX_ASSISTANT_CHARS)) return { error: 'message too long' };
    total += content.length;
    clean.push({ role: expected, content });
  }
  if (total > MAX_TOTAL_CHARS) return { error: 'conversation too long' };
  if (clean[clean.length - 1]!.role !== 'user') return { error: 'last message must be from the user' };
  if (mode === 'job_fit' && (clean.length !== 1 || clean[0]!.content.trim().length < MIN_JOB_CHARS)) return { error: 'bad job description' };

  const parsed = mode === 'job_fit' ? { messages: clean, mode: 'job_fit' as const } : { messages: clean };
  if (turnstileToken === undefined) return parsed;
  if (typeof turnstileToken !== 'string' || turnstileToken === '' || turnstileToken.length > MAX_TOKEN_CHARS) {
    return { error: 'bad turnstile token' };
  }
  return { ...parsed, turnstileToken };
}
