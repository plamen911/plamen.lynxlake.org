import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CASES, fitSection, loadCases, parseLocalCases } from '../scripts/eval-cases';

describe('eval cases', () => {
  it('parses local cases with regex sources', () => {
    const [c] = parseLocalCases('[{"q":"Was he a lighthouse keeper?","kind":"unknown","mustNotInclude":["lighthouse"]}]');
    expect(c?.q).toBe('Was he a lighthouse keeper?');
    expect(c?.kind).toBe('unknown');
    expect(c?.mustNotInclude?.[0]?.test('LIGHTHOUSE')).toBe(true);
  });

  it('rejects malformed local cases', () => {
    expect(() => parseLocalCases('{}')).toThrow();
    expect(() => parseLocalCases('[{"q":"x","kind":"nope"}]')).toThrow(/kind/);
    expect(() => parseLocalCases('[{"kind":"unknown"}]')).toThrow(/"q"/);
    expect(() => parseLocalCases('[{"q":"x","kind":"unknown","mustInclude":"a"}]')).toThrow(/mustInclude/);
  });

  it('parses the tracked example file', () => {
    const example = readFileSync(join(import.meta.dirname, '..', 'scripts', 'eval-cases.local.example.json'), 'utf8');
    expect(parseLocalCases(example).length).toBeGreaterThan(0);
  });

  it('merges scripts/eval-cases.local.json when present, else only the tracked cases', () => {
    const root = mkdtempSync(join(tmpdir(), 'eval-cases-'));
    try {
      expect(loadCases(root)).toEqual(CASES);
      mkdirSync(join(root, 'scripts'));
      writeFileSync(join(root, 'scripts', 'eval-cases.local.json'), '[{"q":"Was he a lighthouse keeper?","kind":"unknown"}]');
      const merged = loadCases(root);
      expect(merged).toHaveLength(CASES.length + 1);
      expect(merged.at(-1)?.q).toBe('Was he a lighthouse keeper?');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('fitSection', () => {
  const answer = 'Fit: partial. Reason.\nMatches:\n- PHP: yes. (see #stack)\nNot shown in the profile:\n- Rust.\nNext step: ask.';

  it('returns only the lines under the label', () => {
    expect(fitSection(answer, 'Matches:')).toContain('PHP');
    expect(fitSection(answer, 'Matches:')).not.toContain('Rust');
    expect(fitSection(answer, 'Not shown in the profile:')).toContain('Rust');
    expect(fitSection(answer, 'Not shown in the profile:')).not.toContain('ask');
    expect(fitSection('Fit: weak.', 'Matches:')).toBe('');
  });
});
