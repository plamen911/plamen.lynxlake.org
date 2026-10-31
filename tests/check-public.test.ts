// All private-looking values in this file are synthetic. Real private values
// live only in the gitignored local list (see scripts/forbidden.local.example.json).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findForbidden, findLiterals, LOCAL_WHY, loadLocalList, parseLocalList, type LocalEntry } from '../scripts/forbidden';
import { collectSources, formatHit, runCheck, scanRepo, scanSources } from '../scripts/check-public';

const FAKE_LOCAL: LocalEntry[] = [
  { value: 'Acme Widgets Ltd', why: 'made-up company' },
  { value: '123456789', why: 'company registration number' },
  { value: '888 000 000', why: 'phone number' },
  { value: 'Institute of Examples', why: 'degree' },
  { value: 'ПРИМЕРНА', why: 'organisation' },
  { pattern: String.raw`lighthouse[\s-]*keep(?:er|ing)`, flags: 'iu', why: 'made-up topic' },
];

describe('findForbidden: generic patterns', () => {
  it.each([
    'Age: 41',
    'aged 41',
    'at the age of 41',
    "I'm 41",
    '41 years old',
    'a 41-year-old developer',
    'born in 1980',
    'born on 3 May 1980',
    'b. 1980',
    'date of birth: 03.05.1980',
    'EIK 123456789',
    'Company reg. no. 123456789',
    'VAT number: BG123456789',
    '+359 888 000 000',
    '0888 000 000',
    'skype',
    'SKYPE: someone',
    'customers include MediaMarkt',
  ])('flags %s', (text) => {
    expect(findForbidden(text).length).toBeGreaterThan(0);
  });

  it.each([
    '€50/hour',
    '€50/hr',
    '50 EUR/h',
    'USD 40 per hour',
    '€40 hourly',
    '$45/h',
    '50 €/hour',
    '40 euros per hour',
    '90 лв/h',
    '€400/day',
    '€6,000 per month',
    'rate: €50',
    'my rate is 50 EUR',
    '€50 per hr',
  ])('flags rate %s', (text) => {
    expect(findForbidden(text).length).toBeGreaterThan(0);
  });

  it.each([
    'Backend engineer building AI into production systems',
    'fire-investigation report drafting',
    'Introduced 436 tests to a three-year-old codebase',
    'Available · remote B2B · Europe (UTC+2)',
    'plamen326@gmail.com',
    'up to 20 messages per hour',
    'Shopify rate-limit handling with jittered retries',
    'Mia reviewed the pull request',
    '20+ years of remote production work',
  ])('does not flag innocent text: %s', (text) => {
    expect(findForbidden(text)).toEqual([]);
  });

  it('does not flag a made-up private topic without the local list', () => {
    expect(findForbidden('worked as a lighthouse keeper')).toEqual([]);
  });

  it('reports the match and the reason', () => {
    const [hit] = findForbidden('Call me on Skype');
    expect(hit?.match.toLowerCase()).toBe('skype');
    expect(hit?.why).toMatch(/skype/i);
  });
});

describe('local list', () => {
  it('flags local literals, case- and spacing-insensitively', () => {
    expect(findLiterals('ACME WIDGETS LTD', FAKE_LOCAL)).toHaveLength(1);
    expect(findLiterals('acme.widgets-ltd', FAKE_LOCAL)).toHaveLength(1);
    expect(findLiterals('Graduated from the Institute of Examples', FAKE_LOCAL)).toHaveLength(1);
    expect(findLiterals('примерна', FAKE_LOCAL)).toHaveLength(1);
    expect(findLiterals('call 888-000-000', FAKE_LOCAL)).toHaveLength(1);
  });

  it('does not match a numeric literal inside a longer number', () => {
    expect(findLiterals('id 91234567890', FAKE_LOCAL)).toEqual([]);
  });

  it('flags local regex patterns (private topics), every match', () => {
    const hits = findLiterals('Worked as a lighthouse keeper; lighthouse-keeping was fun.', FAKE_LOCAL);
    expect(hits.map((h) => h.match)).toEqual(['lighthouse keeper', 'lighthouse-keeping']);
    expect(hits.every((h) => h.why === 'made-up topic' && h.local === true)).toBe(true);
    expect(findLiterals('a lighthouse on the coast', FAKE_LOCAL)).toEqual([]);
  });

  it('findForbidden merges generic patterns and local entries', () => {
    expect(findForbidden('Acme Widgets Ltd', FAKE_LOCAL)).toHaveLength(1);
    expect(findForbidden('Acme Widgets Ltd')).toEqual([]);
    expect(findForbidden('worked as a lighthouse keeper', FAKE_LOCAL)).toHaveLength(1);
  });

  it('parses the local list as an array or as { literals }, with literal and regex entries', () => {
    expect(parseLocalList('[{"value":"x","why":"y"}]')).toEqual([{ value: 'x', why: 'y' }]);
    expect(parseLocalList('{"literals":[{"value":"x"}]}')).toEqual([{ value: 'x', why: LOCAL_WHY }]);
    const json = JSON.stringify([{ pattern: String.raw`a\s+b`, flags: 'i', why: 't' }, { pattern: 'c' }]);
    expect(parseLocalList(json)).toEqual([
      { pattern: String.raw`a\s+b`, flags: 'i', why: 't' },
      { pattern: 'c', why: LOCAL_WHY },
    ]);
    expect(() => parseLocalList('[{"why":"no value"}]')).toThrow();
    expect(() => parseLocalList('[{"pattern":"("}]')).toThrow(/invalid pattern/);
    expect(() => parseLocalList('[{"pattern":""}]')).toThrow();
  });

  it('a regex entry without flags is case-insensitive', () => {
    expect(findLiterals('LIGHTHOUSE KEEPER', parseLocalList('[{"pattern":"lighthouse keeper"}]'))).toHaveLength(1);
  });

  it('parses the tracked example list, with both entry kinds', () => {
    const example = parseLocalList(readFileSync(join(import.meta.dirname, '..', 'scripts', 'forbidden.local.example.json'), 'utf8'));
    expect(example.some((e) => 'pattern' in e)).toBe(true);
    expect(example.some((e) => 'value' in e)).toBe(true);
    expect(findLiterals('He was a lighthouse keeper at Acme Widgets Ltd.', example).length).toBeGreaterThan(1);
  });

  it('loads from FORBIDDEN_LOCAL_JSON first, then the local file, else none', () => {
    const root = mkdtempSync(join(tmpdir(), 'local-list-'));
    try {
      expect(loadLocalList(root, {}).origin).toBe('none');
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'scripts', 'forbidden.local.json'), JSON.stringify(FAKE_LOCAL));
      expect(loadLocalList(root, {}).entries).toEqual(FAKE_LOCAL);
      const fromEnv = loadLocalList(root, { FORBIDDEN_LOCAL_JSON: '[{"value":"Env Only","why":"x"}]' });
      expect(fromEnv.origin).toBe('env');
      expect(fromEnv.entries[0]).toEqual({ value: 'Env Only', why: 'x' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('check-public scanning', () => {
  let root: string;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function tempRoot(): string {
    root = mkdtempSync(join(tmpdir(), 'check-public-'));
    return root;
  }

  it('tolerates a missing dist/ and public/cv/, with warnings', () => {
    const r = tempRoot();
    const result = runCheck(r, { trackedFiles: [] });
    expect(result.hits).toEqual([]);
    expect(result.warnings.join('\n')).toMatch(/dist\/ not found/);
    expect(result.warnings.join('\n')).toMatch(/no local list/);
  });

  it('does not warn about the local list when one is given', () => {
    const r = tempRoot();
    mkdirSync(join(r, 'dist'));
    const result = runCheck(r, { local: FAKE_LOCAL, trackedFiles: [] });
    expect(result.warnings).toEqual([]);
  });

  it('finds a leak in a built html file and ignores binary assets', () => {
    const r = tempRoot();
    mkdirSync(join(r, 'dist', 'about'), { recursive: true });
    writeFileSync(join(r, 'dist', 'about', 'index.html'), '<p>Skype: someone</p>');
    writeFileSync(join(r, 'dist', 'logo.png'), 'skype');
    const hits = scanSources(collectSources(r));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.source).toBe(join('dist', 'about', 'index.html'));
  });

  it('applies only local literals to vendor JS, CSS and source maps', () => {
    const r = tempRoot();
    mkdirSync(join(r, 'dist', '_astro'), { recursive: true });
    writeFileSync(join(r, 'dist', '_astro', 'vendor.js'), 'var a="+359 888 000 000";');
    writeFileSync(join(r, 'dist', '_astro', 'vendor.js.map'), '{"x":"Acme Widgets Ltd"}');
    writeFileSync(join(r, 'dist', 'icon.svg'), '<svg><text>skype</text></svg>');
    writeFileSync(join(r, 'dist', 'site.webmanifest'), '{"name":"a lighthouse keeper"}');
    const hits = scanSources(collectSources(r), FAKE_LOCAL);
    const bySource = (name: string) => hits.filter((h) => h.source === name).map((h) => h.why);
    expect(bySource(join('dist', '_astro', 'vendor.js'))).toEqual(['phone number']);
    expect(bySource(join('dist', '_astro', 'vendor.js.map'))).toEqual(['made-up company']);
    expect(bySource(join('dist', 'icon.svg'))).toEqual(['Skype']);
    expect(bySource(join('dist', 'site.webmanifest'))).toEqual(['made-up topic']);
  });

  it('tolerates public/cv/ without a PDF', () => {
    const r = tempRoot();
    mkdirSync(join(r, 'public', 'cv'), { recursive: true });
    expect(collectSources(r).filter((s) => s.name.endsWith('.pdf'))).toEqual([]);
  });

  it('fails clearly when pdftotext is missing', () => {
    const r = tempRoot();
    mkdirSync(join(r, 'public', 'cv'), { recursive: true });
    writeFileSync(join(r, 'public', 'cv', 'cv.pdf'), '%PDF-1.4');
    expect(() => collectSources(r, { pdftotext: join(r, 'no-such-pdftotext') })).toThrow(/poppler-utils \(pdftotext\)/);
  });

  it('scans git-tracked files for local literals only', () => {
    const r = tempRoot();
    execFileSync('git', ['init', '-q'], { cwd: r });
    writeFileSync(join(r, 'leak.md'), 'Paid through Acme Widgets Ltd.');
    writeFileSync(join(r, 'topic.md'), '// test: worked as a lighthouse keeper');
    writeFileSync(join(r, 'generic.md'), 'Skype and +359 888 111 222 are only generic here.');
    writeFileSync(join(r, 'untracked.md'), 'Acme Widgets Ltd');
    execFileSync('git', ['add', 'leak.md', 'topic.md', 'generic.md'], { cwd: r });
    const hits = scanRepo(r, FAKE_LOCAL);
    expect(hits).toEqual([
      { source: 'repo:leak.md', match: 'Acme Widgets Ltd', why: 'made-up company', local: true },
      { source: 'repo:topic.md', match: 'lighthouse keeper', why: 'made-up topic', local: true },
    ]);
    expect(scanRepo(r, [])).toEqual([]);
  });

  it('redacts local-list hits when asked (CI logs may be public), never generic ones', () => {
    const local = { source: 'repo:x.md', match: 'Acme Widgets Ltd', why: 'made-up company', local: true as const };
    const generic = { source: 'dist/index.html', match: 'Skype', why: 'Skype' };
    expect(formatHit(local, true)).not.toMatch(/Acme|made-up/);
    expect(formatHit(local, false)).toContain('Acme Widgets Ltd');
    expect(formatHit(generic, true)).toContain('Skype');
  });
});
