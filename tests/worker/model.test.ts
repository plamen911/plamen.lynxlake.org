import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/chat/server/env';
import { anthropicClient } from '../../src/chat/server/model';

const env = {
  ANTHROPIC_API_KEY: 'test-key',
  CHAT_MODEL: 'claude-test-model',
} as Env;

const event = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

const CANNED_SSE = [
  event('message_start', {
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-test-model',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 12, output_tokens: 1, cache_read_input_tokens: 3000, cache_creation_input_tokens: 40 },
    },
  }),
  event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hello' } }),
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: ' there' } }),
  event('content_block_stop', { index: 0 }),
  event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } }),
  event('message_stop', {}),
].join('');

describe('anthropicClient', () => {
  it('streams text and usage, sending the expected request', async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input instanceof Request ? input.url : input), body: JSON.parse(String(init?.body)) });
      return new Response(CANNED_SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;

    const { text, usage } = anthropicClient(env, fetchFn).stream('SYSTEM PROMPT', [{ role: 'user', content: 'Hi' }]);
    const chunks: string[] = [];
    for await (const t of text) chunks.push(t);

    expect(chunks).toEqual(['Hello', ' there']);
    expect(await usage).toEqual({
      input_tokens: 12,
      output_tokens: 7,
      cache_read_input_tokens: 3000,
      cache_creation_input_tokens: 40,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(/\/v1\/messages$/);
    const body = requests[0]!.body as {
      model: string;
      max_tokens: number;
      stream: boolean;
      system: { type: string; text: string; cache_control: { type: string } }[];
      messages: unknown;
      thinking: unknown;
      output_config: unknown;
    };
    expect(body.model).toBe('claude-test-model');
    expect(body.max_tokens).toBe(400);
    expect(body.stream).toBe(true);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.output_config).toEqual({ effort: 'low' });
    expect(body.system[0]).toEqual({ type: 'text', text: 'SYSTEM PROMPT', cache_control: { type: 'ephemeral' } });
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('maps missing cache fields to 0', async () => {
    const sse = CANNED_SSE.replace(',"cache_read_input_tokens":3000,"cache_creation_input_tokens":40', '');
    const fetchFn = (async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })) as typeof fetch;
    const { text, usage } = anthropicClient(env, fetchFn).stream('S', [{ role: 'user', content: 'Hi' }]);
    for await (const _ of text) void _;
    expect(await usage).toEqual({ input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  });
});
