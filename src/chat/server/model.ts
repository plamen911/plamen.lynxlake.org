import Anthropic from '@anthropic-ai/sdk';
import type { Usage } from './cost';
import type { Env } from './env';
import type { ChatMessage } from './validate';

export type { Usage };

export const MAX_TOKENS = 400;
/** A job-fit check is a longer, structured reply, and Bulgarian takes more tokens per word. */
export const FIT_MAX_TOKENS = 900;

export interface ModelClient {
  stream(system: string, messages: ChatMessage[], maxTokens?: number): { text: AsyncIterable<string>; usage: Promise<Usage> };
}

/** The production model client: Anthropic Messages API, streamed, with the system prompt cached. */
export function anthropicClient(env: Env, fetchFn?: typeof fetch): ModelClient {
  return {
    stream(system, messages, maxTokens = MAX_TOKENS) {
      // Created per call so a missing key fails inside the guarded call, not at import.
      const client = new Anthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        maxRetries: 0,
        timeout: 30_000,
        ...(fetchFn ? { fetch: fetchFn } : {}),
      });
      const stream = client.messages.stream({
        model: env.CHAT_MODEL,
        max_tokens: maxTokens,
        // Assumes a Haiku 5.5-class CHAT_MODEL: other models may reject or ignore `thinking`/`effort`.
        // Haiku thinks adaptively by default, which can eat the whole token budget and leave no text.
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages,
      });

      async function* text(): AsyncGenerator<string> {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
        }
      }

      const usage = stream.finalMessage().then(({ usage: u }) => ({
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      }));

      return { text: text(), usage };
    },
  };
}
