import { describe, expect, it } from 'vitest';
import { parseSse } from '../src/chat/client/sse';

describe('parseSse', () => {
  it('parses complete delta and done events', () => {
    const { events, carry } = parseSse('data: {"type":"delta","text":"Hi"}\n\ndata: {"type":"done"}\n\n', '');
    expect(events).toEqual([{ type: 'delta', text: 'Hi' }, { type: 'done' }]);
    expect(carry).toBe('');
  });

  it('reassembles an event split across two chunks', () => {
    const first = parseSse('data: {"type":"delta","te', '');
    expect(first.events).toEqual([]);
    const second = parseSse('xt":"Hello"}\n\n', first.carry);
    expect(second.events).toEqual([{ type: 'delta', text: 'Hello' }]);
    expect(second.carry).toBe('');
  });

  it('ignores non-JSON and unknown lines', () => {
    const { events } = parseSse(
      'data: not json\n\n: comment\nevent: x\ndata: {"type":"other"}\ndata: {"type":"delta","text":"ok"}\n\n',
      '',
    );
    expect(events).toEqual([{ type: 'delta', text: 'ok' }]);
  });

  it('handles CRLF line endings', () => {
    const { events } = parseSse('data: {"type":"delta","text":"a"}\r\n\r\ndata: {"type":"done"}\r\n', '');
    expect(events).toEqual([{ type: 'delta', text: 'a' }, { type: 'done' }]);
  });

  it('reports a stream error event', () => {
    const { events } = parseSse('data: {"type":"error"}\n\n', '');
    expect(events).toEqual([{ type: 'error' }]);
  });
});
