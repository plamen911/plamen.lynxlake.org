import { describe, expect, it, vi } from 'vitest';
import { hostnameAllowed, parseHostnames, verifyTurnstile } from '../src/chat/server/turnstile';

const ALLOWED = parseHostnames('plamen.lynxlake.org, *.plamen-site.pages.dev ,localhost,,');

describe('Turnstile hostname allow-list', () => {
  it('parses a comma-separated list, trimmed and lower-cased', () => {
    expect(parseHostnames(' A.example.com ,*.B.dev,, ')).toEqual(['a.example.com', '*.b.dev']);
    expect(parseHostnames(undefined)).toEqual([]);
  });

  it.each(['plamen.lynxlake.org', 'PLAMEN.lynxlake.org', 'localhost', 'abc123.plamen-site.pages.dev', 'x.y.plamen-site.pages.dev'])(
    'allows %s',
    (host) => expect(hostnameAllowed(host, ALLOWED)).toBe(true),
  );

  it.each(['plamen-site.pages.dev', 'other.pages.dev', 'evilplamen-site.pages.dev', 'plamen.lynxlake.org.evil.com', 'lynxlake.org', ''])(
    'rejects %s',
    (host) => expect(hostnameAllowed(host, ALLOWED)).toBe(false),
  );

  it('verifyTurnstile treats a hostname mismatch, or a missing hostname, as a failure', async () => {
    const reply = (body: object) => vi.fn(async () => Response.json(body)) as unknown as typeof fetch;
    expect(await verifyTurnstile('s', 't', null, ALLOWED, reply({ success: true, hostname: 'localhost' }))).toBe(true);
    expect(await verifyTurnstile('s', 't', null, ALLOWED, reply({ success: true, hostname: 'evil.com' }))).toBe(false);
    expect(await verifyTurnstile('s', 't', null, ALLOWED, reply({ success: true }))).toBe(false);
    expect(await verifyTurnstile('s', 't', null, ALLOWED, reply({ success: false, hostname: 'localhost' }))).toBe(false);
    expect(await verifyTurnstile('s', 't', null, [], reply({ success: true, hostname: 'localhost' }))).toBe(false);
  });
});
