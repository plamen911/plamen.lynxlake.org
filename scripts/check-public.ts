// Privacy guard: fails (exit 1) if any private fact appears in public output.
//
// Scans:
// - the built site (dist/): generic patterns on content files (html, txt,
//   json, xml, svg, webmanifest), local literals on every text file including
//   vendor JS/CSS and source maps;
// - the chat's system prompt (buildSystemPrompt(profile)): generic patterns +
//   local literals;
// - the text of the public CV PDF(s) via pdftotext: generic + local;
// - every git-tracked file: local list only (literals and topic patterns).
//
// The local list (literals and topic patterns) comes from FORBIDDEN_LOCAL_JSON
// or the gitignored scripts/forbidden.local.json; without it, only generic
// patterns run and a warning is printed. When the list comes from the env (CI,
// whose logs may be public), hits from it are reported without the matched
// text or its label.
// Usage: npm run check-public

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildSystemPrompt } from '../src/chat/systemPrompt';
import { profile } from '../src/data/profile';
import { findForbidden, findLiterals, loadLocalList, type LocalEntry } from './forbidden';

export interface Source {
  name: string;
  text: string;
  /** Apply the generic patterns too (false = local literals only). */
  generic: boolean;
}

export interface SourceHit {
  source: string;
  match: string;
  why: string;
  local?: true;
}

export interface CheckOptions {
  local?: LocalEntry[];
  pdftotext?: string;
  /** Tracked files to scan for local literals; defaults to `git ls-files`. */
  trackedFiles?: string[];
}

export interface CheckResult {
  hits: SourceHit[];
  warnings: string[];
  scanned: number;
}

export class PdftotextMissingError extends Error {
  constructor() {
    super('pdftotext not found: install poppler-utils (pdftotext)');
  }
}

const DIST_TEXT = new Set(['.html', '.js', '.mjs', '.txt', '.json', '.xml', '.css', '.svg', '.webmanifest', '.map']);
const DIST_GENERIC = new Set(['.html', '.txt', '.json', '.xml', '.svg', '.webmanifest']);
const DEFAULT_PDFTOTEXT =
  ['/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext', '/usr/bin/pdftotext'].find((p) => existsSync(p)) ??
  'pdftotext';

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function pdfText(file: string, pdftotext: string): string {
  try {
    return execFileSync(pdftotext, ['-layout', file, '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new PdftotextMissingError();
    throw err;
  }
}

export function collectSources(root: string, options: CheckOptions = {}): Source[] {
  const sources: Source[] = [];

  for (const file of walk(join(root, 'dist'))) {
    const ext = extname(file).toLowerCase();
    if (DIST_TEXT.has(ext)) {
      sources.push({ name: relative(root, file), text: readFileSync(file, 'utf8'), generic: DIST_GENERIC.has(ext) });
    }
  }

  // What the chat model is told: the profile serialised plus the rules.
  sources.push({ name: 'chat-system-prompt', text: buildSystemPrompt(profile), generic: true });

  sources.push({ name: 'starter-questions', text: profile.starterQuestions.join('\n'), generic: true });

  const pdfs = [join(root, 'public', 'cv'), join(root, 'dist', 'cv')]
    .flatMap(walk)
    .filter((file) => file.toLowerCase().endsWith('.pdf'));
  for (const file of pdfs) {
    sources.push({ name: relative(root, file), text: pdfText(file, options.pdftotext ?? DEFAULT_PDFTOTEXT), generic: true });
  }

  return sources;
}

export function scanSources(sources: Source[], local: LocalEntry[] = []): SourceHit[] {
  return sources.flatMap(({ name, text, generic }) =>
    (generic ? findForbidden(text, local) : findLiterals(text, local)).map((hit) => ({ source: name, ...hit })),
  );
}

function gitTrackedFiles(root: string): string[] {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Every tracked file, against the local list only (literals and topic patterns). */
export function scanRepo(root: string, local: LocalEntry[], files: string[] = gitTrackedFiles(root)): SourceHit[] {
  if (local.length === 0) return [];
  return files.flatMap((file) => {
    const full = join(root, file);
    if (!existsSync(full) || statSync(full).isDirectory()) return [];
    return findLiterals(readFileSync(full, 'utf8'), local).map((hit) => ({ source: `repo:${file}`, ...hit }));
  });
}

export function runCheck(root: string, options: CheckOptions = {}): CheckResult {
  const local = options.local ?? [];
  const warnings: string[] = [];
  if (!existsSync(join(root, 'dist'))) warnings.push('dist/ not found: run `npm run build` first; the built site was not scanned.');
  if (local.length === 0) {
    warnings.push(
      'no local list (FORBIDDEN_LOCAL_JSON or scripts/forbidden.local.json): only generic patterns were checked.',
    );
  }
  const sources = collectSources(root, options);
  const tracked = options.trackedFiles ?? gitTrackedFiles(root);
  const hits = [...scanSources(sources, local), ...scanRepo(root, local, tracked)];
  return { hits, warnings, scanned: sources.length + (local.length > 0 ? tracked.length : 0) };
}

/** One report line; local-list hits are redacted when `redact` is set (CI logs may be public). */
export function formatHit(hit: SourceHit, redact: boolean): string {
  if (hit.local && redact) return `${hit.source}: [redacted] (private fact (local list))`;
  return `${hit.source}: "${hit.match}" (${hit.why})`;
}

function main(): void {
  const root = process.cwd();
  try {
    const { entries, origin } = loadLocalList(root);
    const { hits, warnings, scanned } = runCheck(root, { local: entries });
    for (const warning of warnings) console.warn(`check-public: warning: ${warning}`);
    if (hits.length > 0) {
      console.error(`check-public: ${hits.length} private fact(s) found in public output:`);
      for (const hit of hits) console.error(`  ${formatHit(hit, origin === 'env')}`);
      process.exit(1);
    }
    console.log(`check-public: OK, ${scanned} source(s) scanned, no private facts found.`);
  } catch (err) {
    if (err instanceof PdftotextMissingError) {
      console.error('check-public: pdftotext not found – install poppler-utils (pdftotext).');
    } else {
      console.error(`check-public: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
