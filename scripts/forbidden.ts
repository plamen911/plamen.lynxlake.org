// Privacy guard patterns. Two lists:
//
// - FORBIDDEN (this file, public): generic shapes of private data – phone
//   numbers, rates, ages, company-registration numbers, Skype. They never
//   contain a real private value and never name a private topic.
// - The local list (private): exact private values and patterns for private
//   topics. Each entry is a literal `{ "value", "why" }` or a regex
//   `{ "pattern", "flags", "why" }`. It is read from the env var
//   FORBIDDEN_LOCAL_JSON (CI secret) or from the gitignored
//   scripts/forbidden.local.json. See scripts/forbidden.local.example.json.
//
// Every generic pattern is case-insensitive.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ForbiddenPattern {
  pattern: RegExp;
  why: string;
}

export interface ForbiddenHit {
  match: string;
  why: string;
  /** True when the hit comes from the private local list. */
  local?: true;
}

/** A private value, matched case- and spacing-insensitively. */
export interface LocalLiteral {
  value: string;
  why: string;
}

/** A private topic, as a regex source plus flags (`g` is always added). */
export interface LocalPattern {
  pattern: string;
  flags?: string;
  why: string;
}

export type LocalEntry = LocalLiteral | LocalPattern;

export interface LocalList {
  entries: LocalEntry[];
  origin: 'env' | 'file' | 'none';
}

/** Label used for local entries without their own `why`. */
export const LOCAL_WHY = 'private fact (local list)';

const CURRENCY = String.raw`(?:[€$£]|\b(?:eur|euros?|usd|gbp|bgn)\b|лв\.?)`;
const AMOUNT = String.raw`\d(?:[\d.,]*\d)?`;
const PER_PERIOD = String.raw`(?:\/\s*(?:h|hr|hour|day|d|month|mo)\b|per\s+(?:hour|hr|day|month)\b|an?\s+(?:hour|day|month)\b|hourly|daily|monthly)`;
const MONEY = String.raw`(?:${CURRENCY}\s*${AMOUNT}|${AMOUNT}\s*${CURRENCY})`;

export const FORBIDDEN: ForbiddenPattern[] = [
  // Age / birth year
  { pattern: /\bage[ds]?\s*[:=-]?\s*\d{2}\b/giu, why: 'age' },
  { pattern: /\bage\s+of\s+\d{2}\b/giu, why: 'age' },
  { pattern: /\b\d{2}\s*(?:years?\s+old|-year-old|y\.?o\.?(?!\w))/giu, why: 'age' },
  { pattern: /\bI['’]?m\s+\d{2}\b|\bI\s+am\s+\d{2}\b/giu, why: 'age' },
  { pattern: /\bborn\s+(?:in|on)\b|\bborn\s+\d/giu, why: 'birth date / year' },
  { pattern: /\bb\.\s*(?:19|20)\d{2}\b/giu, why: 'birth year' },
  { pattern: /\bdate\s+of\s+birth\b|\bbirth\s*(?:year|date|day)\b|\bDOB\b/giu, why: 'birth date / year' },

  // Rate
  { pattern: new RegExp(`${MONEY}\\s*${PER_PERIOD}`, 'giu'), why: 'rate' },
  { pattern: new RegExp(`\\brate\\b[^.\\n]{0,20}?${MONEY}`, 'giu'), why: 'rate' },
  { pattern: /hourly\s+rate|day\s+rate|daily\s+rate/giu, why: 'rate' },

  // Company-registration numbers
  { pattern: /\bEIK\b|ЕИК/giu, why: 'company registration number' },
  { pattern: /\b(?:company\s+)?reg(?:istration)?\.?\s*(?:no|number|#)\.?\s*[:#]?\s*\d{6,}/giu, why: 'company registration number' },
  { pattern: /\bVAT\s*(?:no|number|id)?\.?\s*[:#]?\s*[A-Z]{2}\s?\d{8,12}\b/giu, why: 'company registration number' },

  // Phone / Skype
  { pattern: /\+\s*359/gu, why: 'phone number' },
  { pattern: /\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3}[\s.-]?\d{3,4}\b/gu, why: 'phone number' },
  { pattern: /\b08[789]\d[\s.-]?\d{3}[\s.-]?\d{3}\b/gu, why: 'phone number' },
  { pattern: /skype/giu, why: 'Skype' },

  // Browswave's published customers, never to be presented as his clients
  { pattern: /media\s*markt/giu, why: "Browswave's customer (MediaMarkt), not his client" },
  { pattern: /\bLG\s+electronics\b/giu, why: "Browswave's customer (LG), not his client" },
  { pattern: /\bA1\s+bulgaria\b/giu, why: "Browswave's customer (A1), not his client" },

  // Job-search material
  { pattern: /\bCV\s+variants?\b|\bvariant_\w+/giu, why: 'CV variants' },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Turns a private literal into a case-insensitive regex that tolerates spacing/punctuation variants. */
export function literalPattern(value: string): RegExp {
  const parts = value.trim().split(/[\s._-]+/).map(escapeRegExp);
  let body = parts.join('[\\s._-]*');
  if (/^\d/.test(value.trim())) body = `(?<!\\d)${body}`;
  if (/\d$/.test(value.trim())) body = `${body}(?!\\d)`;
  return new RegExp(body, 'giu');
}

/** Compiles a local regex entry; `g` is always added so every match is reported. */
export function localPatternRegExp({ pattern, flags = 'iu' }: LocalPattern): RegExp {
  return new RegExp(pattern, flags.includes('g') ? flags : `${flags}g`);
}

const entryRegExp = (entry: LocalEntry): RegExp =>
  'pattern' in entry ? localPatternRegExp(entry) : literalPattern(entry.value);

function matchAll(text: string, pattern: RegExp, why: string, local = false): ForbiddenHit[] {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((m) => (local ? { match: m[0], why, local: true as const } : { match: m[0], why }));
}

/** Local (private) entries only: literals and patterns. */
// Public URLs Plamen chose to publish. Only this exact text is exempt: the same words anywhere else still fail.
export const PUBLISHED_URLS = ['github.com/plamen911/fire-service-skills'];

export function findLiterals(text: string, local: LocalEntry[]): ForbiddenHit[] {
  const scanned = PUBLISHED_URLS.reduce((t, url) => t.replaceAll(url, ' '), text);
  return local.flatMap((entry) => matchAll(scanned, entryRegExp(entry), entry.why, true));
}

/** Generic patterns plus any local entries. */
export function findForbidden(text: string, local: LocalEntry[] = []): ForbiddenHit[] {
  return [
    ...FORBIDDEN.flatMap(({ pattern, why }) => matchAll(text, pattern, why)),
    ...findLiterals(text, local),
  ];
}

/**
 * Parses the local list: an array (or `{ literals: [...] }`) of literal entries
 * `{ value, why }` and regex entries `{ pattern, flags?, why }`.
 */
export function parseLocalList(json: string): LocalEntry[] {
  const data: unknown = JSON.parse(json);
  const list = Array.isArray(data) ? data : (data as { literals?: unknown }).literals;
  if (!Array.isArray(list)) throw new Error('forbidden local list: expected an array of { value, why } or { pattern, flags, why }');
  return list.map((entry, i): LocalEntry => {
    const { value, pattern, flags, why: rawWhy } = entry as Partial<LocalLiteral & LocalPattern>;
    const why = typeof rawWhy === 'string' && rawWhy.trim() !== '' ? rawWhy : LOCAL_WHY;
    if (typeof pattern === 'string') {
      if (pattern === '') throw new Error(`forbidden local list: entry ${i} has an empty "pattern"`);
      if (flags !== undefined && typeof flags !== 'string') throw new Error(`forbidden local list: entry ${i} has non-string "flags"`);
      const parsed: LocalPattern = flags === undefined ? { pattern, why } : { pattern, flags, why };
      try {
        localPatternRegExp(parsed);
      } catch (err) {
        throw new Error(`forbidden local list: entry ${i} has an invalid pattern (${(err as Error).message})`);
      }
      return parsed;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`forbidden local list: entry ${i} has neither "value" nor "pattern"`);
    }
    return { value, why };
  });
}

/** Env var FORBIDDEN_LOCAL_JSON wins; else scripts/forbidden.local.json under root; else empty. */
export function loadLocalList(root: string, env: Record<string, string | undefined> = process.env): LocalList {
  const fromEnv = env.FORBIDDEN_LOCAL_JSON;
  if (fromEnv && fromEnv.trim() !== '') return { entries: parseLocalList(fromEnv), origin: 'env' };
  const file = join(root, 'scripts', 'forbidden.local.json');
  if (existsSync(file)) return { entries: parseLocalList(readFileSync(file, 'utf8')), origin: 'file' };
  return { entries: [], origin: 'none' };
}
