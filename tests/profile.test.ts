import { describe, expect, it } from 'vitest';
import { profile } from '../src/data/profile';
import { findForbidden, loadLocalList } from '../scripts/forbidden';

describe('public profile', () => {
  it('uses the exact tagline and availability strings', () => {
    expect(profile.tagline).toBe('Backend engineer building AI into production systems');
    expect(profile.availability).toBe('Available · remote B2B · Europe (UTC+2)');
  });

  it('uses the public contact details', () => {
    expect(profile.email).toBe('plamen326@gmail.com');
    expect(profile.links.linkedin.href).toBe('https://www.linkedin.com/in/plamen-markov-14254965');
    expect(profile.links.github.href).toBe('https://github.com/plamen911');
    expect(profile.links.cv.href).toBe('/cv/Plamen_Markov_CV.pdf');
  });

  it('has exactly six projects in the spec order', () => {
    expect(profile.projects.length).toBe(6);
    expect(profile.projects.map((p) => p.id)).toEqual([
      'fire-report-plugin',
      'reporting-agent',
      'chatgpt-connector',
      'mcp-go-checker',
      'ocr-and-rag',
      'site-assistant',
    ]);
  });

  it('links the fire-report plugin to its public repo', () => {
    const plugin = profile.projects.find((p) => p.id === 'fire-report-plugin');
    expect(plugin?.links?.map((l) => l.href)).toEqual(['https://github.com/plamen911/fire-service-skills']);
  });

  it('links the MCP server to its public repo', () => {
    const mcp = profile.projects.find((p) => p.id === 'mcp-go-checker');
    expect(mcp?.links?.map((l) => l.href)).toEqual([
      'https://github.com/plamen911/go-insurance-checker',
      'https://www.npmjs.com/package/go-insurance-checker',
    ]);
  });

  it('lists experience in the spec order', () => {
    expect(profile.experience.map((r) => r.id)).toEqual([
      'smartwary',
      'ivanov-new-media',
      'direct-clients',
      'own-products',
    ]);
  });

  it('puts AI/LLM first in the stack, then Backend, Frontend, Infra, Quality', () => {
    expect(profile.stack[0]?.name).toBe('AI/LLM');
    expect(profile.stack.map((g) => g.name)).toEqual(['AI/LLM', 'Backend', 'Frontend', 'Infra', 'Quality']);
  });

  it('shows only the approved education', () => {
    expect(profile.education).toHaveLength(3);
    expect(profile.education.join(' ')).toMatch(/Gabrovo/);
    expect(profile.education.join(' ')).toMatch(/SoftUni/);
  });

  it('contains no private facts', () => {
    expect(findForbidden(JSON.stringify(profile))).toEqual([]);
  });

  it('contains none of the local private entries (when a local list is available)', () => {
    const { entries } = loadLocalList(process.cwd());
    expect(findForbidden(JSON.stringify(profile), entries)).toEqual([]);
  });

  it('never mentions a company registration or billing entity', () => {
    expect(JSON.stringify(profile)).not.toMatch(/\bEIK\b|ЕИК|company registration|registration number|\bVAT\b|\bLtd\b|\bLLC\b/i);
  });

  it('keeps the Smartwary phrasing: contract with Smartwary, PriceLens taken in-house', () => {
    const smartwary = profile.experience.find((r) => r.id === 'smartwary');
    expect(smartwary?.summary).toContain("B2B contract with Smartwary, building Browswave's product");
    expect(smartwary?.summary).toContain('took PriceLens in-house in October 2026');
    expect(smartwary?.summary).toMatch(/contract continues, with no active project/);
    expect(JSON.stringify(profile)).not.toMatch(/(?:work|worked|working) (?:for|at) Browswave/i);
  });

  it('keeps the Ivanov New Media Studio phrasing', () => {
    const ivanov = profile.experience.find((r) => r.id === 'ivanov-new-media');
    expect(ivanov?.summary).toContain("Ivanov New Media Studio's long-term remote developer");
    expect(ivanov?.summary).toContain('Nantucket Energy was their client');
    expect(JSON.stringify(profile)).not.toMatch(/(?:work|worked|working) (?:for|at) Nantucket Energy/i);
  });

  it('describes the RAG product only in the past tense', () => {
    const strings: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    collect(profile);
    const sentences = strings
      .flatMap((s) => s.split(/(?<=\.)\s+/))
      .filter((s) => /\bRAG\b|retrieval-augmented|pgvector|Cohere/i.test(s));
    expect(sentences.length).toBeGreaterThan(0);
    const present = /\b(?:is|are|runs|combines|uses|merges|reranks|keeps|serves|builds|powers|answers|reads|has|includes|lets)\b/i;
    const past = /\b(?:was|were|built|ran|combined|merged|reranked|used|kept|depended|earlier)\b/i;
    for (const sentence of sentences) {
      expect(sentence, sentence).not.toMatch(present);
      // Full sentences (not stack items or tags) must carry a past-tense marker.
      if (sentence.trim().endsWith('.')) expect(sentence, sentence).toMatch(past);
    }
  });

  it('says ADR Zone is live on the App Store only (not on Google Play)', () => {
    const own = profile.experience.find((r) => r.id === 'own-products');
    const text = own?.highlights.join(' ') ?? '';
    expect(text).toContain('live on the App Store');
    expect(text).not.toMatch(/google play|both stores/i);
  });

  it('has three starter questions', () => {
    expect(profile.starterQuestions.length).toBe(3);
  });
});
