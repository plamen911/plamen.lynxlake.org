import { describe, expect, it, vi } from 'vitest';
import { MAX_NOTIFY_CHARS, notifyQuestion } from '../src/chat/server/notify';

const NOW = new Date('2026-11-01T19:30:00Z');
const TG = { TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHAT_ID: '42' };

describe('notifyQuestion', () => {
  it('does nothing when Telegram is not configured', async () => {
    const fetchFn = vi.fn();
    await notifyQuestion({}, { question: 'Is he available?', host: 'plamen.lynxlake.org', newVisitor: true, now: NOW }, fetchFn);
    await notifyQuestion({ TELEGRAM_BOT_TOKEN: '123:abc' }, { question: 'x', host: 'h', newVisitor: false, now: NOW }, fetchFn);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('posts the question, host, time and visitor kind to the bot chat as plain text', async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: true }));
    await notifyQuestion(TG, { question: 'Is he available?', host: 'plamen.lynxlake.org', newVisitor: true, now: NOW }, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe('42');
    expect(body.parse_mode).toBeUndefined();
    expect(body.disable_web_page_preview).toBe(true);
    expect(body.text).toContain('plamen.lynxlake.org');
    expect(body.text).toContain('new visitor');
    expect(body.text).toContain('2026-11-01 19:30 UTC');
    expect(body.text).toContain('Is he available?');
  });

  it('marks follow-up questions from a returning session', async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: true }));
    await notifyQuestion(TG, { question: 'And his rate?', host: 'h', newVisitor: false, now: NOW }, fetchFn);
    const body = JSON.parse((fetchFn.mock.calls[0]! as unknown as [string, RequestInit])[1].body as string);
    expect(body.text).toContain('follow-up');
  });

  it('truncates long questions', async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: true }));
    await notifyQuestion(TG, { question: 'a'.repeat(5000), host: 'h', newVisitor: true, now: NOW }, fetchFn);
    const body = JSON.parse((fetchFn.mock.calls[0]! as unknown as [string, RequestInit])[1].body as string);
    expect(body.text).toContain('a'.repeat(MAX_NOTIFY_CHARS) + '…');
    expect(body.text).not.toContain('a'.repeat(MAX_NOTIFY_CHARS + 1));
  });

  it('never throws when Telegram fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      notifyQuestion(TG, { question: 'q', host: 'h', newVisitor: true, now: NOW }, vi.fn(async () => { throw new Error('down'); })),
    ).resolves.toBeUndefined();
    await expect(
      notifyQuestion(TG, { question: 'q', host: 'h', newVisitor: true, now: NOW }, vi.fn(async () => new Response('no', { status: 400 }))),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
