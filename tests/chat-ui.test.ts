// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAT_TITLE, fallbackLine, FIT_TOGGLE, mountChat, NOTICE_LINE } from '../src/chat/client/chat';

const STARTERS = ['What AI work has he shipped?', 'Is he available?', "What's his stack?"];
const EMAIL = 'someone@example.com';
const FALLBACK = `The assistant is unavailable right now — email me at ${EMAIL}.`;
const TITLE = "Ask an AI assistant about Plamen's work";
const NOTICE =
  'Answers are AI-generated from this page and may be wrong — for anything important, email me. ' +
  'Questions, job descriptions and rated answers are stored for 30 days, without IP addresses, so I can see what people ask. ' +
  "If you leave your email, it goes only to Plamen so he can reply; it isn't stored on this site.";

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

describe('contact dialog', () => {
  const TOGGLE = 'Want Plamen to get back to you? Leave your email';
  const THANKS = 'Thanks — Plamen will reply by email.';
  const SORRY = `Couldn't send right now — please email ${EMAIL}.`;

  const toggle = () => root.querySelector<HTMLButtonElement>('button.chat-contact-toggle')!;
  const dialog = () => root.querySelector<HTMLDialogElement>('dialog.chat-contact-dialog')!;
  const contactForm = () => dialog().querySelector<HTMLFormElement>('form.chat-contact')!;
  const field = <T extends HTMLElement>(name: string) => contactForm().querySelector<T>(`[name="${name}"]`)!;
  const submitButton = () => contactForm().querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const cancelButton = () => contactForm().querySelector<HTMLButtonElement>('button.chat-contact-cancel')!;
  const closeX = () => dialog().querySelector<HTMLButtonElement>('button.chat-contact-x')!;
  const done = () => dialog().querySelector<HTMLElement>('.chat-contact-done')!;
  const doneClose = () => done().querySelector<HTMLButtonElement>('button')!;
  /** The message inside the dialog (invalid email, failure, thanks). */
  const note = () => dialog().querySelector<HTMLElement>('.chat-contact-note')!;
  /** The live region under the chat, outside the dialog. */
  const status = () => root.querySelector<HTMLElement>('.chat-contact-status')!;
  const ok = () => ({ ok: true, status: 200, body: null, json: async () => ({ ok: true }) }) as unknown as Response;

  function open(): void {
    toggle().focus();
    toggle().click();
  }

  async function submitContact(email: string, name = 'Jane Doe', message = 'We have a role.'): Promise<void> {
    field<HTMLInputElement>('email').value = email;
    field<HTMLInputElement>('name').value = name;
    field<HTMLTextAreaElement>('message').value = message;
    contactForm().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
  }

  function expectClosed(): void {
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(toggle());
  }

  it('shows a trigger after the input row that opens a labelled modal dialog', () => {
    mount(vi.fn());
    const button = toggle();
    expect(button.textContent).toBe(TOGGLE);
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(root.querySelector('form.chat-form')!.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(dialog().open).toBe(false);

    open();
    expect(dialog().open).toBe(true);
    const heading = dialog().querySelector<HTMLElement>('h2')!;
    expect(heading.textContent).toBe('Leave your email for Plamen');
    expect(dialog().getAttribute('aria-labelledby')).toBe(heading.id);
    expect(dialog().textContent).toContain("He'll reply by email. Your email goes only to Plamen and isn't stored on this site.");
    const email = field<HTMLInputElement>('email');
    expect(email.type).toBe('email');
    expect(email.required).toBe(true);
    expect(email.autocomplete).toBe('email');
    expect(field<HTMLInputElement>('name').required).toBe(true);
    expect(field<HTMLTextAreaElement>('message').tagName).toBe('TEXTAREA');
    expect(field<HTMLTextAreaElement>('message').maxLength).toBe(1000);
    for (const name of ['email', 'name', 'message']) {
      expect(contactForm().querySelector(`label[for="${field(name).id}"]`)?.textContent?.trim(), name).toBeTruthy();
    }
    expect(submitButton().textContent).toBe('Send to Plamen');
    expect(cancelButton().textContent).toBe('Cancel');
    expect(cancelButton().type).toBe('button');
    expect(closeX().getAttribute('aria-label')).toBe('Close');
    expect(closeX().type).toBe('button');
    expect(done().hidden).toBe(true);
    expect(document.activeElement).toBe(email);
    expect(status().getAttribute('aria-live')).toBe('polite');
    expect(dialog().contains(status())).toBe(false);
  });

  it('closes with Cancel and returns focus to the trigger', () => {
    mount(vi.fn());
    open();
    cancelButton().click();
    expectClosed();
  });

  it('closes with the × button and returns focus to the trigger', () => {
    mount(vi.fn());
    open();
    closeX().click();
    expectClosed();
  });

  it('closes on Esc (the cancel event) and returns focus to the trigger', () => {
    mount(vi.fn());
    open();
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    expectClosed();
  });

  it('closes on an Escape keydown and returns focus to the trigger', () => {
    mount(vi.fn());
    open();
    field('email').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expectClosed();
  });

  it('closes on a click on the backdrop, but not on a click inside the box', () => {
    mount(vi.fn());
    open();
    field('email').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    field('email').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog().open).toBe(true);
    // A drag that starts in a field and ends on the backdrop doesn't close it.
    field('email').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dialog().open).toBe(true);
    dialog().dispatchEvent(new Event('pointerdown', { bubbles: true }));
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expectClosed();
  });

  it('posts the contact to /api/contact, thanks the visitor and resets the form', async () => {
    const fetchFn = vi.fn(async () => ok());
    mount(fetchFn);
    open();
    await submitContact('  jane@example.com ', 'Jane', 'We have a role.');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as FetchArgs;
    expect(url).toBe('/api/contact');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'jane@example.com', name: 'Jane', message: 'We have a role.' });

    expect(dialog().open).toBe(true);
    expect(done().hidden).toBe(false);
    expect(done().textContent).toContain(THANKS);
    expect(contactForm().hidden).toBe(true);
    expect(doneClose().textContent).toBe('Close');
    expect(document.activeElement).toBe(doneClose());
    // Written to the live region under the chat once the dialog closes, so it is announced then.
    expect(status().textContent).toBe('');
    expect(field<HTMLInputElement>('email').value).toBe('');
    expect(field<HTMLInputElement>('name').value).toBe('');
    expect(field<HTMLTextAreaElement>('message').value).toBe('');

    doneClose().click();
    expectClosed();
    expect(status().textContent).toBe(THANKS);

    // The next open shows the empty form again.
    open();
    expect(contactForm().hidden).toBe(false);
    expect(done().hidden).toBe(true);
    expect(note().textContent).toBe('');
    expect(document.activeElement).toBe(field('email'));
  });

  it('requires a name and a message, flagging the first missing field', async () => {
    const fetchFn = vi.fn(async () => ok());
    mount(fetchFn);
    open();
    expect(field('name').hasAttribute('required')).toBe(true);
    expect(field('message').hasAttribute('required')).toBe(true);
    await submitContact('jane@example.com', '  ', 'Hello');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(field('name').getAttribute('aria-invalid')).toBe('true');
    expect(note().textContent).toBe('Please enter your name.');
    expect(document.activeElement).toBe(field('name'));
    await submitContact('jane@example.com', 'Jane', ' \n ');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(field('name').hasAttribute('aria-invalid')).toBe(false);
    expect(field('message').getAttribute('aria-invalid')).toBe('true');
    expect(note().textContent).toBe('Please write a short message.');
    expect(document.activeElement).toBe(field('message'));
    await submitContact('jane@example.com', 'Jane', 'Hello');
    expect(JSON.parse(String((fetchFn.mock.calls[0] as unknown as FetchArgs)[1]?.body))).toEqual({
      email: 'jane@example.com',
      name: 'Jane',
      message: 'Hello',
    });
  });

  it('replaces tabs with spaces and strips other control characters before sending', async () => {
    const fetchFn = vi.fn(async () => ok());
    mount(fetchFn);
    open();
    await submitContact('jane@example.com', 'Ja\u0007ne\tDoe', 'Role:\tBackend\u0000\r\nRemote\u001b ok');
    expect(JSON.parse(String((fetchFn.mock.calls[0] as unknown as FetchArgs)[1]?.body))).toEqual({
      email: 'jane@example.com',
      name: 'Jane Doe',
      message: 'Role: Backend\nRemote ok',
    });
  });

  it('rejects an address list or a display-name address', async () => {
    const fetchFn = vi.fn(async () => ok());
    mount(fetchFn);
    open();
    for (const bad of ['a@example.com,b@example.com', 'Jane <jane@example.com>', 'a@example.com;b@example.com']) {
      await submitContact(bad);
      expect(fetchFn, bad).not.toHaveBeenCalled();
    }
  });

  it('gets a Turnstile token on 401 and retries once', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse(401, 'verify')).mockResolvedValueOnce(ok());
    const getTurnstileToken = vi.fn(async () => 'tok-9');
    mount(fetchFn, { getTurnstileToken });
    open();
    await submitContact('jane@example.com');
    expect(getTurnstileToken).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchFn.mock.calls[1] as unknown as FetchArgs)[1]?.body)).turnstileToken).toBe('tok-9');
    expect(done().textContent).toContain(THANKS);
  });

  it.each([
    ['503', () => jsonResponse(503, 'unavailable')],
    ['429', () => jsonResponse(429, 'rate_limited')],
    ['a second 401', () => jsonResponse(401, 'verify')],
  ])('shows the email fallback in the dialog on %s and keeps it open', async (_name, make) => {
    mount(vi.fn(async () => make()), { getTurnstileToken: async () => 'tok' });
    open();
    await submitContact('jane@example.com', 'Jane', 'Hello');
    expect(dialog().open).toBe(true);
    expect(note().textContent).toBe(SORRY);
    expect(note().querySelector('a')?.getAttribute('href')).toBe(`mailto:${EMAIL}`);
    expect(contactForm().hidden).toBe(false);
    expect(done().hidden).toBe(true);
    expect(field<HTMLTextAreaElement>('message').value).toBe('Hello');
    expect(submitButton().disabled).toBe(false);
    expect(document.activeElement).toBe(note());
    expect(status().textContent).toBe('');
  });

  it('shows the email fallback on a network error', async () => {
    mount(vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    open();
    await submitContact('jane@example.com');
    expect(note().textContent).toBe(SORRY);
  });

  it('requires a valid email before sending', async () => {
    const fetchFn = vi.fn(async () => ok());
    mount(fetchFn);
    open();
    for (const bad of ['', '   ', 'not-an-email', 'jane@localhost']) {
      await submitContact(bad);
      expect(fetchFn, bad).not.toHaveBeenCalled();
      expect(field('email').getAttribute('aria-invalid')).toBe('true');
      expect(field('email').getAttribute('aria-describedby')).toBe(note().id);
      expect(note().textContent).toBe('Please enter a valid email address.');
      expect(document.activeElement).toBe(field('email'));
    }
    await submitContact('jane@example.com');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(field('email').hasAttribute('aria-invalid')).toBe(false);
  });

  it('is busy while sending and ignores a second submit', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = vi.fn(async () => {
      await gate;
      return ok();
    });
    mount(fetchFn);
    open();
    await submitContact('jane@example.com');
    expect(submitButton().disabled).toBe(true);
    expect(contactForm().getAttribute('aria-busy')).toBe('true');
    contactForm().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    submitButton().click();
    await settle();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(contactForm().getAttribute('aria-busy')).toBe('false');
    expect(done().textContent).toContain(THANKS);
  });

  it('can be closed while a request is in flight; a late success is announced under the chat', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mount(vi.fn(async () => {
      await gate;
      return ok();
    }));
    open();
    await submitContact('jane@example.com', 'Jane', 'Hello');
    cancelButton().click();
    expectClosed();
    release();
    await settle();
    expect(dialog().open).toBe(false);
    expect(status().textContent).toBe(THANKS);
    expect(document.activeElement).toBe(toggle());
    open();
    expect(contactForm().hidden).toBe(false);
    expect(field<HTMLTextAreaElement>('message').value).toBe('');
  });

  it('can be closed while a request is in flight; a late failure keeps the text and points to the email', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mount(vi.fn(async () => {
      await gate;
      return jsonResponse(503, 'unavailable');
    }));
    open();
    await submitContact('jane@example.com', 'Jane', 'Hello');
    dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    expectClosed();
    release();
    await settle();
    expect(dialog().open).toBe(false);
    expect(status().textContent).toBe(SORRY);
    expect(document.activeElement).toBe(toggle());
    open();
    expect(field<HTMLTextAreaElement>('message').value).toBe('Hello');
    expect(submitButton().disabled).toBe(false);
  });

  it('opens and closes with the open attribute when showModal is unavailable', () => {
    const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
    const showModal = proto.showModal;
    const close = proto.close;
    proto.showModal = undefined;
    proto.close = undefined;
    try {
      mount(vi.fn());
      open();
      expect(dialog().hasAttribute('open')).toBe(true);
      expect(document.activeElement).toBe(field('email'));
      cancelButton().click();
      expect(dialog().hasAttribute('open')).toBe(false);
      expect(document.activeElement).toBe(toggle());
    } finally {
      proto.showModal = showModal;
      proto.close = close;
    }
  });

  it('points to the contact section when data-email is missing', async () => {
    root.removeAttribute('data-email');
    mount(vi.fn(async () => jsonResponse(503, 'unavailable')));
    open();
    await submitContact('jane@example.com');
    expect(note().textContent).toBe("Couldn't send right now — please use the contact details below.");
    expect(note().querySelector('a')?.getAttribute('href')).toBe('#contact');
  });
});

describe('job-fit check', () => {
  const JOB = 'Senior backend engineer. Must have: PHP, Laravel and LLM integration. Remote, B2B contract in Europe.';
  const toggle = () => [...root.querySelectorAll<HTMLButtonElement>('.chat-contact-toggle')].find((b) => b.textContent === FIT_TOGGLE)!;
  const dialog = () => root.querySelector<HTMLDialogElement>('#chat-fit-dialog')!;
  const text = () => dialog().querySelector<HTMLTextAreaElement>('textarea')!;

  async function submit(value: string): Promise<void> {
    toggle().click();
    text().value = value;
    dialog().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await settle();
  }

  it('sends the job description alone, in job-fit mode, and shows the answer in the chat', async () => {
    const fetchFn = vi.fn(async () => answer('Fit: strong.'));
    mount(fetchFn);
    await submit(JOB);
    const body = JSON.parse(String((fetchFn.mock.calls[0] as unknown as FetchArgs)[1]?.body));
    expect(body.mode).toBe('job_fit');
    expect(body.messages).toEqual([{ role: 'user', content: JOB }]);
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(lastAnswer().textContent).toBe('Fit: strong.');
    expect(text().value).toBe('');
  });

  it('shortens the job description in the chat log', async () => {
    mount(vi.fn(async () => answer('Fit: strong.')));
    await submit('x'.repeat(500));
    const shown = root.querySelector('.chat-msg.user')!.textContent!;
    expect(shown.startsWith('Job description: x')).toBe(true);
    expect(shown.length).toBeLessThan(170);
  });

  it('refuses a too-short text without calling the API, and keeps the dialog open', async () => {
    const fetchFn = vi.fn();
    mount(fetchFn);
    await submit('Laravel dev');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(dialog().querySelector('.chat-contact-note')!.textContent).toMatch(/too short/);
  });

  it('keeps the text and shows the fallback when the check fails', async () => {
    mount(vi.fn(async () => jsonResponse(503, 'unavailable')));
    await submit(JOB);
    expect(lastAnswer().textContent).toBe(FALLBACK);
    expect(text().value).toBe(JOB);
  });

  it('lets a follow-up question use the answer, without resending the job description', async () => {
    const fetchFn = vi.fn(async () => answer('Fit: strong.'));
    mount(fetchFn);
    await submit(JOB);
    await ask('Why strong?');
    const body = JSON.parse(String((fetchFn.mock.calls[1] as unknown as FetchArgs)[1]?.body));
    expect(body.mode).toBeUndefined();
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(body.messages)).not.toContain('Must have');
  });
});

describe('chat actions and ratings', () => {
  const withAction = (name: string) => streamResponse(sse({ type: 'delta', text: 'Sure.' }, { type: 'action', name }, { type: 'done' }));

  it('shows a button for an offered form, which opens it', async () => {
    mount(vi.fn(async () => withAction('offer_contact_form')));
    await ask('We have a role');
    const button = root.querySelector<HTMLButtonElement>('.chat-offer')!;
    expect(button.textContent).toBe('Leave your email');
    button.click();
    expect(root.querySelector('#chat-contact-dialog')!.hasAttribute('open')).toBe(true);
  });

  it('opens the job description form for the job-fit offer', async () => {
    mount(vi.fn(async () => withAction('offer_job_fit_check')));
    await ask('Would he fit?');
    root.querySelector<HTMLButtonElement>('.chat-offer')!.click();
    expect(root.querySelector('#chat-fit-dialog')!.hasAttribute('open')).toBe(true);
  });

  it('shows no button for an unknown action, and none on a plain answer', async () => {
    mount(vi.fn(async () => withAction('delete_everything')));
    await ask('Hi');
    expect(root.querySelector('.chat-offer')).toBeNull();
  });

  it('sends one rating with the question and answer, then says thanks', async () => {
    const fetchFn = vi.fn(async () => answer('Yes.'));
    mount(fetchFn);
    await ask('Is he available?');
    const [yes, no] = root.querySelectorAll<HTMLButtonElement>('.chat-rate');
    expect(yes!.textContent).toBe('Yes');
    no!.click();
    await settle();
    const call = fetchFn.mock.calls[1] as unknown as FetchArgs;
    expect(String(call[0])).toBe('/api/feedback');
    expect(JSON.parse(String(call[1]?.body))).toEqual({ vote: 'down', question: 'Is he available?', answer: 'Yes.' });
    expect(root.querySelector('.chat-rating')!.textContent).toBe('Thanks for the feedback.');
    expect(root.querySelector('.chat-rate')).toBeNull();
  });

  it('shows no rating when the answer failed', async () => {
    mount(vi.fn(async () => jsonResponse(503, 'unavailable')));
    await ask('Hi');
    expect(root.querySelector('.chat-rating')).toBeNull();
  });
});
