import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse, type Node } from 'ultrahtml';
import { querySelector, querySelectorAll } from 'ultrahtml/selector';
import { clickKeys } from '../src/data/clicks';
import { profile } from '../src/data/profile';

const root = join(import.meta.dirname, '..');
let doc: Node;

// ultrahtml keeps entities as written; decode the few Astro emits.
function decode(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(node: Node, name: string): string | undefined {
  const value = node.attributes?.[name] as string | undefined;
  return value === undefined ? undefined : decode(value);
}

function text(node: Node | undefined | null): string {
  if (!node) return '';
  if (node.type === 2) return decode(node.value as string); // TEXT_NODE
  return ((node.children ?? []) as Node[]).map(text).join('');
}

beforeAll(() => {
  const env: NodeJS.ProcessEnv = { ...process.env, ALLOW_MISSING_TURNSTILE: '1' };
  // An empty value in process.env overrides .env.production, which holds the real token.
  env.PUBLIC_CF_ANALYTICS_TOKEN = '';
  execSync('npm run build', { cwd: root, stdio: 'pipe', env });
  doc = parse(readFileSync(join(root, 'dist', 'index.html'), 'utf8'));
}, 180_000);

describe('one-page site', () => {
  it('has one h1 with the name', () => {
    const h1s = querySelectorAll(doc, 'h1');
    expect(h1s.length).toBe(1);
    expect(text(h1s[0]).trim()).toBe('Plamen Markov');
  });

  it('shows the tagline and availability badge', () => {
    const body = text(querySelector(doc, 'body'));
    expect(body).toContain(profile.tagline);
    expect(body).toContain(profile.availability);
  });

  it('links email and CV', () => {
    expect(querySelector(doc, 'a[href="mailto:plamen326@gmail.com"]')).toBeTruthy();
    expect(querySelector(doc, 'a[href="/cv/Plamen_Markov_CV.pdf"]')).toBeTruthy();
  });

  it('opens CV, email, LinkedIn and GitHub links in a new tab with rel=noopener', () => {
    const hrefs = [
      '/cv/Plamen_Markov_CV.pdf',
      'mailto:plamen326@gmail.com',
      profile.links.linkedin.href,
      profile.links.github.href,
    ];
    for (const href of hrefs) {
      const links = querySelectorAll(doc, `a[href="${href}"]`);
      expect(links.length).toBeGreaterThan(0);
      for (const a of links) {
        expect(a.attributes.target).toBe('_blank');
        expect(a.attributes.rel).toContain('noopener');
      }
    }
  });

  it('marks every counted link with a click name the API accepts', () => {
    const keys = clickKeys(profile.projects);
    expect(new Set(keys).size).toBe(keys.length);
    const marked = querySelectorAll(doc, 'a[data-click]').map((a: Node) => attr(a, 'data-click'));
    expect(new Set(marked)).toEqual(new Set(keys));
    for (const a of querySelectorAll(doc, `a[href^="mailto:"]`)) expect(attr(a, 'data-click')).toBe('email');
    expect(attr(querySelector(doc, 'a[href="https://www.npmjs.com/package/go-insurance-checker"]'), 'data-click')).toBe('mcp-go-checker:npmjs');
  });

  it('has every citation section id', () => {
    for (const id of ['projects', 'ai-workflow', 'experience', 'stack', 'contact']) {
      expect(querySelector(doc, `#${id}`), id).toBeTruthy();
    }
  });

  it('renders four project articles, the fire-report one without any link', () => {
    expect(querySelectorAll(doc, 'article.project').length).toBe(4);
    const card = querySelector(doc, 'article.project#project-fire-report-plugin');
    expect(card).toBeTruthy();
    expect(querySelector(card, 'a')).toBeFalsy();
    expect(profile.projects.find((p) => p.id === 'fire-report-plugin')?.links).toBeUndefined();
  });

  it('renders the experience roles and stack groups', () => {
    expect(querySelectorAll(doc, '#experience article').length).toBe(profile.experience.length);
    const stack = text(querySelector(doc, '#stack'));
    for (const group of profile.stack) expect(stack).toContain(group.name);
  });

  it('gives the chat a mount point with starters and a no-JS email fallback', () => {
    const chat = querySelector(doc, '#chat-root');
    expect(chat).toBeTruthy();
    expect(JSON.parse(attr(chat, 'data-starters') ?? '')).toEqual(profile.starterQuestions);
    expect(attr(chat, 'data-email')).toBe(profile.email);
    expect(text(querySelector(chat, '.panel-title'))).toBe("Questions about Plamen's work");
    expect(text(chat)).toContain(profile.email);
    expect(querySelector(chat, `a[href="mailto:${profile.email}"]`)).toBeTruthy();
  });

  it('has the page meta', () => {
    expect(querySelector(doc, 'html').attributes.lang).toBe('en');
    expect(text(querySelector(doc, 'title'))).toBe('Plamen Markov — Backend & AI Engineer');
    expect(attr(querySelector(doc, 'meta[name="description"]'), 'content')).toContain(profile.tagline);
    expect(querySelector(doc, 'meta[property="og:title"]')).toBeTruthy();
    expect(querySelector(doc, 'meta[property="og:description"]')).toBeTruthy();
  });

  it('has the site URL, Open Graph image and favicons', () => {
    expect(attr(querySelector(doc, 'link[rel="canonical"]'), 'href')).toBe('https://plamen.lynxlake.org/');
    expect(attr(querySelector(doc, 'meta[property="og:url"]'), 'content')).toBe('https://plamen.lynxlake.org/');
    expect(attr(querySelector(doc, 'meta[property="og:image"]'), 'content')).toBe('https://plamen.lynxlake.org/og.png');
    expect(attr(querySelector(doc, 'meta[name="twitter:card"]'), 'content')).toBe('summary_large_image');
    expect(attr(querySelector(doc, 'link[rel="icon"][type="image/svg+xml"]'), 'href')).toBe('/favicon.svg');
    for (const file of ['og.png', 'favicon.svg', 'favicon.ico']) expect(existsSync(join(root, 'dist', file)), file).toBe(true);
    const png = readFileSync(join(root, 'dist', 'og.png'));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it('ships _headers with the CSP and security headers', () => {
    const headers = readFileSync(join(root, 'dist', '_headers'), 'utf8');
    const csp = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1] ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
    expect(csp).toMatch(/frame-src [^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toMatch(/connect-src 'self' https:\/\/cloudflareinsights\.com/);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(headers).toMatch(/Referrer-Policy: strict-origin-when-cross-origin/);
    expect(headers).toMatch(/Permissions-Policy: camera=\(\), microphone=\(\), geolocation=\(\)/);
    expect(headers).toMatch(/X-Content-Type-Options: nosniff/);
  });

  it('has no inline scripts, styles or style attributes, so the CSP needs no unsafe-inline', () => {
    const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
    for (const script of querySelectorAll(doc, 'script')) {
      expect(attr(script, 'src'), 'every script is external').toBeTruthy();
      expect(text(script).trim()).toBe('');
    }
    expect(querySelectorAll(doc, 'style')).toHaveLength(0);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it('omits the analytics beacon when no token is set', () => {
    expect(querySelector(doc, 'script[src*="cloudflareinsights"]')).toBeFalsy();
  });
});
