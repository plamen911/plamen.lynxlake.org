export type SseEvent = { type: 'delta'; text: string } | { type: 'done' } | { type: 'error' };

/**
 * Incremental parser for the chat's Server-Sent Events. `carry` is the
 * unfinished last line of the previous chunk; pass the returned `carry` back in
 * with the next chunk. Only `data:` lines holding a known JSON event are
 * returned; anything else (comments, other fields, bad JSON) is ignored.
 */
export function parseSse(chunk: string, carry: string): { events: SseEvent[]; carry: string } {
  const lines = (carry + chunk).split('\n');
  const rest = lines.pop() ?? '';
  const events: SseEvent[] = [];

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line.startsWith('data:')) continue;
    const event = toEvent(line.slice(5).trimStart());
    if (event) events.push(event);
  }
  return { events, carry: rest };
}

function toEvent(data: string): SseEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { type, text } = value as Record<string, unknown>;
  if (type === 'delta' && typeof text === 'string') return { type, text };
  if (type === 'done' || type === 'error') return { type };
  return null;
}
