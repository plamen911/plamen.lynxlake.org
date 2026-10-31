// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTurnstile } from '../src/chat/client/turnstile';

type Callbacks = Record<string, (arg?: string) => unknown>;

let appended: HTMLScriptElement[];
let container: HTMLElement;

/** A fake window.turnstile that records render options and resets. */
function fakeApi() {
  const renders: Callbacks[] = [];
  const api = {
    render: vi.fn((_el: HTMLElement, options: Record<string, unknown>) => {
      renders.push(options as Callbacks);
      return `widget-${renders.length}`;
    }),
    reset: vi.fn(),
  };
  return { api, renders };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  appended = [];
  container = document.createElement('div');
  document.body.replaceChildren(container);
  // Capture the script instead of letting happy-dom load it; tests fire load/error themselves.
  vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
    for (const node of nodes) if (node instanceof HTMLScriptElement) appended.push(node);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.turnstile;
});

describe('createTurnstile', () => {
  it('rejects without a site key and loads nothing', async () => {
    await expect(createTurnstile('', container).getToken()).rejects.toThrow(/site key/);
    expect(appended).toHaveLength(0);
  });

  it('retries loading the script after a script error instead of failing for good', async () => {
    const client = createTurnstile('site-key', container);
    const first = client.getToken();
    expect(appended).toHaveLength(1);
    appended[0]!.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow(/failed to load/);

    const second = client.getToken();
    expect(appended).toHaveLength(2);
    const { api, renders } = fakeApi();
    window.turnstile = api;
    appended[1]!.dispatchEvent(new Event('load'));
    expect(api.render).toHaveBeenCalledTimes(1);
    renders[0]!.callback!('token-1');
    await expect(second).resolves.toBe('token-1');
  });

  it('resets the widget after a token is used, and hands out each token once', async () => {
    const { api, renders } = fakeApi();
    window.turnstile = api;
    const client = createTurnstile('site-key', container);
    client.prepare();
    expect(appended).toHaveLength(0); // already loaded: render straight away
    renders[0]!.callback!('token-1');
    await expect(client.getToken()).resolves.toBe('token-1');
    expect(api.reset).toHaveBeenCalledWith('widget-1');

    const next = client.getToken();
    let done = false;
    void next.then(() => (done = true));
    await flush();
    expect(done).toBe(false); // the used token is not handed out again
    renders[0]!.callback!('token-2');
    await expect(next).resolves.toBe('token-2');
  });

  it('marks widget errors as handled and recovers on the next getToken', async () => {
    const { api, renders } = fakeApi();
    window.turnstile = api;
    const client = createTurnstile('site-key', container);
    const first = client.getToken();
    expect(renders[0]!['error-callback']!()).toBe(true);
    await expect(first).rejects.toThrow(/turnstile error/);

    const second = client.getToken();
    expect(api.reset).toHaveBeenCalledWith('widget-1');
    renders[0]!.callback!('token-2');
    await expect(second).resolves.toBe('token-2');
  });
});
