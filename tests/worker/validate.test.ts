import { describe, expect, it } from 'vitest';
import { parseChatRequest } from '../../src/chat/server/validate';
import { issueSession, verifySession } from '../../src/chat/server/session';
import { costMicros } from '../../src/chat/server/cost';

const user = (content: string) => ({ role: 'user' as const, content });
const assistant = (content: string) => ({ role: 'assistant' as const, content });

describe('parseChatRequest', () => {
  const alternating = (n: number, userText = 'q', assistantText = 'a') =>
    Array.from({ length: n }, (_, i) => (i % 2 === 0 ? user(userText) : assistant(assistantText)));

  it('rejects 13 messages', () => {
    expect(parseChatRequest({ messages: alternating(13) })).toHaveProperty('error');
  });

  it('accepts 11 alternating messages', () => {
    expect(parseChatRequest({ messages: alternating(11) })).not.toHaveProperty('error');
  });

  it('rejects a 601-char user message and accepts 600', () => {
    expect(parseChatRequest({ messages: [user('x'.repeat(601))] })).toHaveProperty('error');
    expect(parseChatRequest({ messages: [user('x'.repeat(600))] })).not.toHaveProperty('error');
  });

  it('allows assistant messages up to 2000 chars', () => {
    expect(parseChatRequest({ messages: [user('q'), assistant('y'.repeat(2000)), user('q')] })).not.toHaveProperty('error');
    expect(parseChatRequest({ messages: [user('q'), assistant('y'.repeat(2001)), user('q')] })).toHaveProperty('error');
  });

  it('rejects more than 12000 chars in total', () => {
    // 6 x 600 + 5 x 2000 = 13600
    expect(parseChatRequest({ messages: alternating(11, 'x'.repeat(600), 'y'.repeat(2000)) })).toHaveProperty('error');
    // 6 x 600 + 4 x 2000 + 1 x 400 = 12000
    const ok = alternating(11, 'x'.repeat(600), 'y'.repeat(2000));
    ok[9] = assistant('y'.repeat(400));
    expect(parseChatRequest({ messages: ok })).not.toHaveProperty('error');
  });

  it('rejects a conversation whose last message is from the assistant', () => {
    expect(parseChatRequest({ messages: [user('hi'), assistant('hello')] })).toHaveProperty('error');
  });

  it('requires the first message from the user and alternating roles', () => {
    expect(parseChatRequest({ messages: [assistant('hello'), user('hi')] })).toHaveProperty('error');
    expect(parseChatRequest({ messages: [user('a'), user('b')] })).toHaveProperty('error');
    expect(parseChatRequest({ messages: [user('a'), assistant('b'), assistant('c'), user('d')] })).toHaveProperty('error');
  });

  it('accepts a valid 2-turn request and keeps only role and content', () => {
    const result = parseChatRequest({
      messages: [user('Who is Plamen?'), { ...assistant('A backend engineer.'), extra: 1 }, user('Is he available?')],
      turnstileToken: 'tok',
    });
    expect(result).toEqual({
      messages: [user('Who is Plamen?'), assistant('A backend engineer.'), user('Is he available?')],
      turnstileToken: 'tok',
    });
  });

  it('rejects other shapes', () => {
    for (const body of [
      null,
      'x',
      {},
      { messages: [] },
      { messages: [{ role: 'system', content: 'x' }] },
      { messages: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] },
      { messages: [user('   ')] },
      { messages: [user('ok')], turnstileToken: 5 },
    ]) {
      expect(parseChatRequest(body)).toHaveProperty('error');
    }
  });
});

describe('session', () => {
  const secret = 'test-session-secret';
  const now = Date.UTC(2026, 9, 31, 12, 0, 0);

  it('verifies an issued session', () => {
    expect(verifySession(secret, issueSession(secret, now), now)).toBe(true);
  });

  it('rejects a tampered session', () => {
    const value = issueSession(secret, now);
    const [exp, mac] = value.split('.');
    expect(verifySession(secret, `${Number(exp) + 3600}.${mac}`, now)).toBe(false);
    expect(verifySession(secret, `${exp}.${mac!.slice(0, -1)}${mac!.endsWith('A') ? 'B' : 'A'}`, now)).toBe(false);
    expect(verifySession('other-secret', value, now)).toBe(false);
    expect(verifySession(secret, undefined, now)).toBe(false);
    expect(verifySession(secret, 'garbage', now)).toBe(false);
  });

  it('rejects an expired session', () => {
    expect(verifySession(secret, issueSession(secret, now), now + 2 * 3600_000 + 1000)).toBe(false);
  });
});

describe('costMicros', () => {
  it('prices every token kind', () => {
    const prices = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };
    expect(
      costMicros({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }, prices),
    ).toBe(2500);
    expect(costMicros({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000 }, prices)).toBe(1250);
  });
});
