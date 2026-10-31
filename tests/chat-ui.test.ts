// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_TITLE, fallbackLine, mountChat, NOTICE_LINE } from '../src/chat/client/chat';

const STARTERS = ['What AI work has he shipped?', 'Is he available?', "What's his stack?"];
const EMAIL = 'someone@example.com';
const FALLBACK = `The assistant is unavailable right now — email me at ${EMAIL}.`;
const TITLE = "Ask an AI assistant about Plamen's work";
const NOTICE =
  'Answers are AI-generated from this page and may be wrong — for anything important, email me. ' +
  'Questions are stored for 30 days, without IP addresses, so I can see what people ask.';

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

/** A minimal fetch Response whose body streams the given chunks. */
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

function sse(...events: object[]): string[] {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
}

function answer(text: string): Response {
  return streamResponse(sse({ type: 'delta', text }, { type: 'done' }));
}

function jsonResponse(status: number, error: string): Response {
  return { ok: false, status, body: null, json: async () => ({ error }) } as unknown as Response;
}

function bodyOf(call: FetchArgs): { messages: Array<{ role: string; content: string }>; turnstileToken?: string } {
  return JSON.parse(String(call[1]?.body));
}

let root: HTMLElement;

function mount(fetchFn: ReturnType<typeof vi.fn>, extra: { getTurnstileToken?: () => Promise<string>; siteKey?: string } = {}) {
  mountChat(root, {
    endpoint: '/api/chat',
    siteKey: extra.siteKey ?? '',
    fetchFn: fetchFn as unknown as typeof fetch,
    getTurnstileToken: extra.getTurnstileToken,
  });
}

function starterButtons(): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>('button.chat-starter')];
}

function input(): HTMLInputElement {
  return root.querySelector<HTMLInputElement>('input.chat-input')!;
}

function sendButton(): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>('button.chat-send')!;
}

function lastAnswer(): HTMLElement {
  const answers = root.querySelectorAll<HTMLElement>('.chat-msg.assistant');
  return answers[answers.length - 1]!;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

async function ask(text: string): Promise<void> {
  input().value = text;
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = `<div id="chat-root" data-email="${EMAIL}" data-starters='${JSON.stringify(STARTERS).replace(/'/g, '&#39;')}'><p class="static">static fallback</p></div>`;
  root = document.getElementById('chat-root')!;
});

afterEach(() => {
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

describe('mountChat', () => {
  it('exports the exact title, fallback and notice lines', () => {
    expect(CHAT_TITLE).toBe(TITLE);
    expect(fallbackLine(EMAIL)).toBe(FALLBACK);
    expect(NOTICE_LINE).toBe(NOTICE);
  });

  it('discloses the AI in the title and the notice, with the email from data-email', () => {
    mount(vi.fn());
    expect(root.querySelector('.chat-title')?.textContent).toBe(TITLE);
    const notice = root.querySelector('.chat-notice')!;
    expect(notice.textContent).toBe(NOTICE);
    expect(notice.querySelector('a')?.getAttribute('href')).toBe(`mailto:${EMAIL}`);
    expect(notice.querySelector('a')?.textContent).toBe('email me');
  });

  it('shows a fallback without an address, pointing to the contact section, when data-email is missing', async () => {
    root.removeAttribute('data-email');
    mount(vi.fn(async () => jsonResponse(503, 'unavailable')));
    expect(root.querySelector('.chat-notice')?.textContent).toBe(NOTICE);
    expect(root.querySelector('.chat-notice a')).toBeNull();
    await ask('hello');
    expect(lastAnswer().textContent).toBe('The assistant is unavailable right now — please use the contact details below.');
    expect(lastAnswer().querySelector('a')?.getAttribute('href')).toBe('#contact');
  });

  it('moves focus to the input once a starter question has been answered', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mount(vi.fn(async () => {
      await gate;
      return answer('Done.');
    }));
    const starter = starterButtons()[1]!;
    starter.focus();
    starter.click();
    await settle();
    expect(document.activeElement).not.toBe(input());
    release();
    await settle();
    expect(document.activeElement).toBe(input());
  });


  it('replaces the static fallback with starters, a labelled input and the 30-day notice', () => {
    mount(vi.fn());
    expect(root.querySelector('.static')).toBeNull();
    expect(starterButtons().map((b) => b.textContent)).toEqual(STARTERS);
    const field = input();
    expect(field.maxLength).toBe(600);
    expect(root.querySelector(`label[for="${field.id}"]`)?.textContent?.trim()).toBeTruthy();
    expect(root.textContent).toContain(NOTICE);
    expect(root.querySelector('[aria-live="polite"]')).toBeTruthy();
  });

  it('sends a starter question and renders the streamed answer', async () => {
    const fetchFn = vi.fn(async () =>
      streamResponse(['data: {"type":"delta","text":"He shipped "}\n\ndata: {"type":"del', 'ta","text":"an agent."}\n\n', 'data: {"type":"done"}\n\n']),
    );
    mount(fetchFn);
    starterButtons()[0]!.click();
    await settle();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as FetchArgs;
    expect(url).toBe('/api/chat');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(bodyOf([url, init]).messages).toEqual([{ role: 'user', content: STARTERS[0] }]);
    expect(lastAnswer().textContent).toBe('He shipped an agent.');
    expect(root.textContent).toContain(STARTERS[0]);
  });

  it('renders an answer containing <script> as text, creating no element', async () => {
    const evil = '<script>window.pwned = 1</script><img src=x onerror="alert(1)">';
    mount(vi.fn(async () => answer(evil)));
    await ask('hi');
    expect(lastAnswer().textContent).toBe(evil);
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('img')).toBeNull();
  });

  it('renders (see #id) citations as in-page links and nothing else as links', async () => {
    mount(vi.fn(async () => answer('He built an MCP server. (see #projects) Also (see #evil) [x](javascript:alert(1))')));
    await ask('projects?');
    const links = lastAnswer().querySelectorAll('a');
    expect(links.length).toBe(1);
    expect(links[0]!.getAttribute('href')).toBe('#projects');
  });

  it('runs Turnstile once on 401 and retries with the token', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse(401, 'verify')).mockResolvedValueOnce(answer('Yes.'));
    const getTurnstileToken = vi.fn(async () => 'tok-123');
    mount(fetchFn, { getTurnstileToken });
    await ask('Is he available?');
    expect(getTurnstileToken).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(bodyOf(fetchFn.mock.calls[0] as unknown as FetchArgs).turnstileToken).toBeUndefined();
    expect(bodyOf(fetchFn.mock.calls[1] as unknown as FetchArgs).turnstileToken).toBe('tok-123');
    expect(lastAnswer().textContent).toBe('Yes.');
  });

  it('shows the fallback after a second 401', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, 'verify'));
    const getTurnstileToken = vi.fn(async () => 'tok');
    mount(fetchFn, { getTurnstileToken });
    await ask('hello');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(getTurnstileToken).toHaveBeenCalledTimes(1);
    expect(lastAnswer().textContent).toBe(FALLBACK);
  });

  it('shows the fallback on 401 when no site key is configured', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(401, 'verify'));
    mount(fetchFn, { siteKey: '' });
    await ask('hello');
    expect(lastAnswer().textContent).toBe(FALLBACK);
  });

  it.each([
    ['429', () => jsonResponse(429, 'rate_limited')],
    ['503', () => jsonResponse(503, 'unavailable')],
    ['400', () => jsonResponse(400, 'invalid')],
    ['a stream error event', () => streamResponse(sse({ type: 'delta', text: 'Half an ans' }, { type: 'error' }))],
    ['a stream without done', () => streamResponse(sse({ type: 'delta', text: 'Half an ans' }))],
  ])('shows the exact fallback line on %s', async (_name, make) => {
    mount(vi.fn(async () => make()));
    await ask('hello');
    expect(lastAnswer().textContent).toBe(FALLBACK);
    expect(lastAnswer().querySelector(`a[href="mailto:${EMAIL}"]`)).toBeTruthy();
  });

  it('shows the fallback on a network error', async () => {
    mount(vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await ask('hello');
    expect(lastAnswer().textContent).toBe(FALLBACK);
  });

  it('is busy while streaming: send and starters disabled, log aria-busy', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = vi.fn(async () => {
      await gate;
      return answer('Done.');
    });
    mount(fetchFn);
    await ask('slow');
    expect(sendButton().disabled).toBe(true);
    expect(starterButtons().every((b) => b.disabled)).toBe(true);
    expect(root.querySelector('[aria-live="polite"]')!.getAttribute('aria-busy')).toBe('true');
    await ask('ignored while busy');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(sendButton().disabled).toBe(false);
    expect(root.querySelector('[aria-live="polite"]')!.getAttribute('aria-busy')).toBe('false');
  });

  it('does not send an empty question', async () => {
    const fetchFn = vi.fn();
    mount(fetchFn);
    await ask('   ');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends history trimmed to the last 12 messages, alternating from a user turn', async () => {
    let n = 0;
    const fetchFn = vi.fn(async () => answer(`answer ${++n}`));
    mount(fetchFn);
    for (let i = 1; i <= 8; i++) await ask(`question ${i}`);
    const last = bodyOf(fetchFn.mock.calls[7] as unknown as FetchArgs).messages;
    expect(last.length).toBeLessThanOrEqual(12);
    expect(last[0]!.role).toBe('user');
    last.forEach((m, i) => expect(m.role).toBe(i % 2 === 0 ? 'user' : 'assistant'));
    expect(last[last.length - 1]).toEqual({ role: 'user', content: 'question 8' });
    expect(last[last.length - 2]).toEqual({ role: 'assistant', content: 'answer 7' });
  });

  it('keeps the request within 12000 chars and assistant turns within 2000', async () => {
    const long = 'x'.repeat(2500);
    const fetchFn = vi.fn(async () => answer(long));
    mount(fetchFn);
    for (let i = 1; i <= 6; i++) await ask('q'.repeat(600));
    const sent = bodyOf(fetchFn.mock.calls[5] as unknown as FetchArgs).messages;
    expect(sent[0]!.role).toBe('user');
    expect(sent.every((m) => m.content.length <= (m.role === 'user' ? 600 : 2000))).toBe(true);
    expect(sent.reduce((s, m) => s + m.content.length, 0)).toBeLessThanOrEqual(12000);
  });

  it('drops a failed turn from the history so roles keep alternating', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(answer('first answer'))
      .mockResolvedValueOnce(jsonResponse(503, 'unavailable'))
      .mockResolvedValueOnce(answer('third answer'));
    mount(fetchFn);
    await ask('one');
    await ask('two');
    await ask('three');
    expect(bodyOf(fetchFn.mock.calls[2] as unknown as FetchArgs).messages).toEqual([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'three' },
    ]);
  });

  it('loads the Turnstile script lazily on first interaction only', () => {
    // Never fetch the real script: happy-dom treats the disabled load as a success.
    const { settings } = (window as unknown as { happyDOM: { settings: Record<string, boolean> } }).happyDOM;
    settings.disableJavaScriptFileLoading = true;
    settings.handleDisabledFileLoadingAsSuccess = true;
    mount(vi.fn(), { siteKey: '1x00000000000000000000AA' });
    const selector = 'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]';
    expect(document.querySelector(selector)).toBeNull();
    input().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    input().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.querySelectorAll(selector).length).toBe(1);
    expect(document.querySelector(selector)!.getAttribute('src')).toContain('render=explicit');
  });

  it('does not load Turnstile when no site key is configured', () => {
    mount(vi.fn(), { siteKey: '' });
    input().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
  });
});
