/** USD per million tokens. */
export interface Prices {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

/**
 * Cost in micro-dollars. USD per MTok times tokens equals micro-dollars, so
 * no scaling is needed. Rounded up so spend is never under-counted.
 */
export function costMicros(usage: Usage, prices: Prices): number {
  const micros =
    usage.input_tokens * prices.input +
    usage.output_tokens * prices.output +
    (usage.cache_read_input_tokens ?? 0) * prices.cacheRead +
    (usage.cache_creation_input_tokens ?? 0) * prices.cacheWrite;
  return Math.ceil(Number(micros.toFixed(6)));
}
