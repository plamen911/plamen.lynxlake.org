import { describe, expect, it, vi } from 'vitest';
import { onRequest, wwwRedirect } from '../functions/_middleware';

describe('www redirect middleware', () => {
  it('sends www to the canonical host with 301, keeping path and query', () => {
    const res = wwwRedirect(new Request('https://www.plamen.lynxlake.org/cv/Plamen_Markov_CV.pdf?x=1'));
    expect(res?.status).toBe(301);
    expect(res?.headers.get('Location')).toBe('https://plamen.lynxlake.org/cv/Plamen_Markov_CV.pdf?x=1');
  });

  it('uses 308 for non-GET requests so the method is kept', () => {
    const res = wwwRedirect(new Request('https://www.plamen.lynxlake.org/api/chat', { method: 'POST', body: '{}' }));
    expect(res?.status).toBe(308);
    expect(res?.headers.get('Location')).toBe('https://plamen.lynxlake.org/api/chat');
  });

  it('passes other hosts through to the site', async () => {
    for (const host of ['plamen.lynxlake.org', 'plamen-site.pages.dev', 'abc123.plamen-site.pages.dev', 'localhost:8788']) {
      const next = vi.fn(async () => new Response('ok'));
      const res = await onRequest({ request: new Request(`http://${host}/`), next });
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).toBe(200);
    }
  });
});
