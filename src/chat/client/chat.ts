import { parseSse } from './sse';
import { createTurnstile } from './turnstile';

export const CHAT_TITLE = "Ask an AI assistant about Plamen's work";
const NOTICE_AI = 'Answers are AI-generated from this page and may be wrong — for anything important, ';
const NOTICE_EMAIL = 'email me';
const NOTICE_STORAGE = 'Questions are stored for 30 days, without IP addresses, so I can see what people ask.';
const NOTICE_CONTACT = "If you leave your email, it goes only to Plamen so he can reply; it isn't stored on this site.";
export const NOTICE_LINE = `${NOTICE_AI}${NOTICE_EMAIL}. ${NOTICE_STORAGE} ${NOTICE_CONTACT}`;

export const CONTACT_TOGGLE = 'Want Plamen to get back to you? Leave your email';
export const CONTACT_THANKS = 'Thanks — Plamen will reply by email.';
const CONTACT_INVALID = 'Please enter a valid email address.';
const CONTACT_FAIL_START = "Couldn't send right now — ";
const CONTACT_MAX_NAME = 100;
const CONTACT_MAX_MESSAGE = 1000;
const CONTACT_TIMEOUT_MS = 30_000;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const FALLBACK_START = 'The assistant is unavailable right now — ';
const FALLBACK_NO_EMAIL = 'please use the contact details below.';

/** The line shown in place of an answer on any failure. */
export const fallbackLine = (email: string): string => `${FALLBACK_START}email me at ${email}.`;

const MAX_MESSAGES = 12;
const MAX_USER_CHARS = 600;
const MAX_ASSISTANT_CHARS = 2000;
const MAX_TOTAL_CHARS = 12_000;
const REQUEST_TIMEOUT_MS = 60_000;

/** The page sections an answer may cite as `(see #id)`, with their link text. */
const SECTIONS: Record<string, string> = {
  projects: 'Projects',
  'ai-workflow': 'AI workflow',
  experience: 'Experience',
  stack: 'Stack',
  contact: 'Contact',
};
const CITATION = /\(see #(projects|ai-workflow|experience|stack|contact)\)/g;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MountOptions {
  endpoint: string;
  /** Where the "Leave your email" form posts; defaults to /api/contact. */
  contactEndpoint?: string;
  siteKey: string;
  fetchFn?: typeof fetch;
  getTurnstileToken?: () => Promise<string>;
}

class ChatFailure extends Error {}

/**
 * The request history the API accepts: at most 12 messages and 12000 chars,
 * starting with a user turn, each turn cut to its length limit. Drops the
 * oldest user/assistant pairs first. `history` must alternate and end with a
 * user turn.
 */
export function trimHistory(history: ChatMessage[]): ChatMessage[] {
  const messages = history.map(({ role, content }) => ({
    role,
    content: content.slice(0, role === 'user' ? MAX_USER_CHARS : MAX_ASSISTANT_CHARS),
  }));
  let start = Math.max(0, messages.length - MAX_MESSAGES);
  if (messages[start]?.role !== 'user') start++;
  const size = (from: number) => messages.slice(from).reduce((sum, m) => sum + m.content.length, 0);
  while (messages.length - start > 1 && size(start) > MAX_TOTAL_CHARS) start += 2;
  return messages.slice(start);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Writes answer text into `target` as text nodes; only `(see #id)` citations become links. */
function renderAnswer(target: HTMLElement, text: string): void {
  const parts: Node[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const id = match[1]!;
    parts.push(document.createTextNode(text.slice(last, match.index) + '(see '));
    const link = el('a', 'chat-cite', SECTIONS[id]);
    link.href = `#${id}`;
    parts.push(link, document.createTextNode(')'));
    last = match.index + match[0].length;
  }
  parts.push(document.createTextNode(text.slice(last)));
  target.replaceChildren(...parts);
}

/** `fallbackLine(email)` with the address as a mailto link; without an email, a pointer to #contact. */
function renderFallback(target: HTMLElement, email: string): void {
  if (!email) {
    const link = el('a', undefined, FALLBACK_NO_EMAIL.slice(0, -1));
    link.href = '#contact';
    target.replaceChildren(document.createTextNode(FALLBACK_START), link, document.createTextNode('.'));
    return;
  }
  const link = el('a', undefined, email);
  link.href = `mailto:${email}`;
  target.replaceChildren(document.createTextNode(`${FALLBACK_START}email me at `), link, document.createTextNode('.'));
}

/** NOTICE_LINE, with "email me" as a mailto link when the email is known. */
function renderNotice(target: HTMLElement, email: string): void {
  if (!email) {
    target.textContent = NOTICE_LINE;
    return;
  }
  const link = el('a', undefined, NOTICE_EMAIL);
  link.href = `mailto:${email}`;
  target.replaceChildren(document.createTextNode(NOTICE_AI), link, document.createTextNode(`. ${NOTICE_STORAGE} ${NOTICE_CONTACT}`));
}

/** "Couldn't send right now — please email <email>." as a mailto link; without an email, a pointer to #contact. */
function renderContactFailure(target: HTMLElement, email: string): void {
  if (!email) {
    const link = el('a', undefined, FALLBACK_NO_EMAIL.slice(0, -1));
    link.href = '#contact';
    target.replaceChildren(document.createTextNode(CONTACT_FAIL_START), link, document.createTextNode('.'));
    return;
  }
  const link = el('a', undefined, email);
  link.href = `mailto:${email}`;
  target.replaceChildren(document.createTextNode(`${CONTACT_FAIL_START}please email `), link, document.createTextNode('.'));
}

/** A labelled field for the contact form. */
function contactField<K extends 'input' | 'textarea'>(tag: K, name: string, labelText: string): { row: HTMLElement; control: HTMLElementTagNameMap[K] } {
  const row = el('div', 'chat-contact-field');
  const label = el('label', undefined, labelText);
  const control = el(tag, 'chat-input');
  control.id = `chat-contact-${name}`;
  control.name = name;
  label.htmlFor = control.id;
  row.append(label, control);
  return { row, control };
}

/** The contact email from `data-email` on the mount point (from profile.email), or '' if absent. */
function readEmail(root: HTMLElement): string {
  const email = root.dataset.email?.trim() ?? '';
  return /^[^\s@]+@[^\s@]+$/.test(email) ? email : '';
}

function readStarters(root: HTMLElement): string[] {
  try {
    const value: unknown = JSON.parse(root.dataset.starters ?? '[]');
    return Array.isArray(value) ? value.filter((q): q is string => typeof q === 'string' && q.trim() !== '') : [];
  } catch {
    return [];
  }
}

/**
 * Replaces the static content of `root` with the streaming chat. Everything
 * the model returns is written as text; only citations become in-page links.
 * Any failure shows the fallback line in place of the answer. The email comes
 * from `data-email` on `root`; starters from `data-starters`.
 */
export function mountChat(root: HTMLElement, opts: MountOptions): void {
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  const history: ChatMessage[] = [];
  const email = readEmail(root);
  let busy = false;

  const wrapper = el('div', 'chat');
  const title = el('p', 'chat-title', CHAT_TITLE);
  title.id = 'chat-title';

  const log = el('div', 'chat-log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.setAttribute('aria-busy', 'false');
  log.setAttribute('aria-labelledby', title.id);

  const starterList = el('ul', 'chat-starters');
  const starterButtons = readStarters(root).map((question) => {
    const button = el('button', 'chat-starter', question);
    button.type = 'button';
    button.addEventListener('click', () => void send(question, true));
    const item = el('li');
    item.append(button);
    starterList.append(item);
    return button;
  });

  const form = el('form', 'chat-form');
  const label = el('label', 'visually-hidden', 'Your question');
  const input = el('input', 'chat-input');
  input.id = 'chat-input';
  label.htmlFor = input.id;
  input.type = 'text';
  input.name = 'question';
  input.maxLength = MAX_USER_CHARS;
  input.autocomplete = 'off';
  input.enterKeyHint = 'send';
  input.placeholder = 'Ask a question…';
  const sendButton = el('button', 'chat-send', 'Send');
  sendButton.type = 'submit';
  form.append(label, input, sendButton);

  // "Leave your email": a toggle below the input row and an inline form.
  const contactToggle = el('button', 'chat-contact-toggle', CONTACT_TOGGLE);
  contactToggle.type = 'button';
  const contactForm = el('form', 'chat-contact');
  contactForm.id = 'chat-contact';
  contactForm.hidden = true;
  contactForm.setAttribute('aria-busy', 'false');
  contactForm.setAttribute('aria-label', 'Leave your email for Plamen');
  contactToggle.setAttribute('aria-controls', contactForm.id);
  contactToggle.setAttribute('aria-expanded', 'false');
  const contactEmail = contactField('input', 'email', 'Your email');
  contactEmail.control.type = 'email';
  contactEmail.control.required = true;
  contactEmail.control.autocomplete = 'email';
  contactEmail.control.maxLength = 254;
  const contactName = contactField('input', 'name', 'Your name (optional)');
  contactName.control.type = 'text';
  contactName.control.autocomplete = 'name';
  contactName.control.maxLength = CONTACT_MAX_NAME;
  const contactMessage = contactField('textarea', 'message', 'Message (optional)');
  contactMessage.control.maxLength = CONTACT_MAX_MESSAGE;
  contactMessage.control.rows = 3;
  const contactSend = el('button', 'chat-send', 'Send to Plamen');
  contactSend.type = 'submit';
  contactForm.append(contactEmail.row, contactName.row, contactMessage.row, contactSend);
  const contactStatus = el('p', 'chat-contact-status');
  contactStatus.id = 'chat-contact-status';
  contactStatus.tabIndex = -1;
  contactStatus.setAttribute('role', 'status');
  contactStatus.setAttribute('aria-live', 'polite');

  const turnstileBox = el('div', 'chat-turnstile');
  const notice = el('p', 'chat-notice');
  renderNotice(notice, email);
  wrapper.append(title, log, starterList, form, contactToggle, contactForm, contactStatus, turnstileBox, notice);

  const turnstile = opts.getTurnstileToken ? null : createTurnstile(opts.siteKey, turnstileBox);
  const getToken = opts.getTurnstileToken ?? (() => turnstile!.getToken());

  // Load Turnstile on the first interaction, not on page load.
  if (turnstile) {
    const prepare = () => {
      root.removeEventListener('focusin', prepare);
      root.removeEventListener('pointerdown', prepare);
      turnstile.prepare();
    };
    root.addEventListener('focusin', prepare);
    root.addEventListener('pointerdown', prepare);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send(input.value);
  });

  function setBusy(value: boolean): void {
    busy = value;
    sendButton.disabled = value;
    for (const button of starterButtons) button.disabled = value;
    log.setAttribute('aria-busy', String(value));
    wrapper.classList.toggle('is-busy', value);
  }

  function addMessage(role: ChatMessage['role'], text: string): HTMLElement {
    const message = el('p', `chat-msg ${role}`, text);
    log.append(message);
    log.scrollTop = log.scrollHeight;
    return message;
  }

  async function post(messages: ChatMessage[], turnstileToken: string | undefined, signal: AbortSignal): Promise<Response> {
    return fetchFn(opts.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnstileToken ? { messages, turnstileToken } : { messages }),
      signal,
    });
  }

  /** Streams the answer into `bubble`; resolves with the full text only after `done`. */
  async function request(messages: ChatMessage[], bubble: HTMLElement, signal: AbortSignal): Promise<string> {
    let response = await post(messages, undefined, signal);
    if (response.status === 401) {
      const token = await getToken();
      response = await post(messages, token, signal);
    }
    if (response.status !== 200 || !response.body) throw new ChatFailure(`status ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let carry = '';
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      const chunk = done ? decoder.decode() + '\n' : decoder.decode(value, { stream: true });
      const parsed = parseSse(chunk, carry);
      carry = parsed.carry;
      for (const event of parsed.events) {
        if (event.type === 'error') throw new ChatFailure('stream error');
        if (event.type === 'done') {
          if (text.trim() === '') throw new ChatFailure('empty answer');
          void reader.cancel().catch(() => {});
          return text;
        }
        text += event.text;
        bubble.classList.remove('is-pending');
        renderAnswer(bubble, text);
        log.scrollTop = log.scrollHeight;
      }
      if (done) throw new ChatFailure('stream ended without done');
    }
  }

  /** `fromStarter`: the starter button is disabled while busy, so focus moves to the input afterwards. */
  async function send(raw: string, fromStarter = false): Promise<void> {
    const question = raw.trim().slice(0, MAX_USER_CHARS);
    if (busy || question === '') return;
    setBusy(true);
    input.value = '';
    addMessage('user', question);
    history.push({ role: 'user', content: question });
    const bubble = addMessage('assistant', '');
    bubble.classList.add('is-pending');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const answer = await request(trimHistory(history), bubble, controller.signal);
      history.push({ role: 'assistant', content: answer });
    } catch {
      // Keep the history alternating: the failed question is not resent.
      history.pop();
      bubble.classList.remove('is-pending');
      bubble.classList.add('is-error');
      renderFallback(bubble, email);
    } finally {
      clearTimeout(timer);
      setBusy(false);
      if (fromStarter) input.focus();
    }
  }

  let contactBusy = false;

  function setContactOpen(open: boolean): void {
    contactForm.hidden = !open;
    contactToggle.setAttribute('aria-expanded', String(open));
  }

  contactToggle.addEventListener('click', () => {
    const open = contactToggle.getAttribute('aria-expanded') !== 'true';
    setContactOpen(open);
    if (open) {
      contactStatus.replaceChildren();
      contactEmail.control.focus();
    }
  });

  function setContactBusy(value: boolean): void {
    contactBusy = value;
    contactSend.disabled = value;
    contactSend.textContent = value ? 'Sending…' : 'Send to Plamen';
    contactForm.setAttribute('aria-busy', String(value));
  }

  async function postContact(body: Record<string, string>, signal: AbortSignal): Promise<Response> {
    const send = (token?: string) =>
      fetchFn(opts.contactEndpoint ?? '/api/contact', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(token ? { ...body, turnstileToken: token } : body),
        signal,
      });
    const response = await send();
    return response.status === 401 ? send(await getToken()) : response;
  }

  contactForm.addEventListener('submit', (event) => {
    event.preventDefault();
    void sendContact();
  });

  async function sendContact(): Promise<void> {
    if (contactBusy) return;
    const address = contactEmail.control.value.trim();
    if (address === '' || address.length > 254 || !EMAIL_SHAPE.test(address)) {
      contactEmail.control.setAttribute('aria-invalid', 'true');
      contactEmail.control.setAttribute('aria-describedby', contactStatus.id);
      contactStatus.textContent = CONTACT_INVALID;
      contactEmail.control.focus();
      return;
    }
    contactEmail.control.removeAttribute('aria-invalid');
    contactEmail.control.removeAttribute('aria-describedby');

    const body: Record<string, string> = { email: address };
    const name = contactName.control.value.trim().slice(0, CONTACT_MAX_NAME);
    const message = contactMessage.control.value.trim().slice(0, CONTACT_MAX_MESSAGE);
    if (name) body.name = name;
    if (message) body.message = message;

    setContactBusy(true);
    contactStatus.replaceChildren();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONTACT_TIMEOUT_MS);
    let sent = false;
    try {
      sent = (await postContact(body, controller.signal)).status === 200;
    } catch {
      sent = false;
    } finally {
      clearTimeout(timer);
      setContactBusy(false);
    }
    if (sent) {
      contactForm.reset();
      setContactOpen(false);
      contactStatus.textContent = CONTACT_THANKS;
      contactStatus.focus();
    } else {
      // The send button was disabled while busy, which drops focus: move it to the message (and its mailto link).
      renderContactFailure(contactStatus, email);
      contactStatus.focus();
    }
  }

  root.replaceChildren(wrapper);
  root.classList.add('is-live');
}
