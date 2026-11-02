// Runs the eval cases against a local `npm run evals:server` with the real model.
// Usage: npm run evals   (BASE_URL overrides http://localhost:8788)

import { findForbidden, loadLocalList } from './forbidden';
import { profile } from '../src/data/profile';
import { buildSystemPrompt } from '../src/chat/systemPrompt';
import { EMAIL_RE, NUMBER_BACKSTOP, UNKNOWN_BG, UNKNOWN_EN, loadCases, type EvalCase } from './eval-cases';

const BASE = process.env.BASE_URL ?? 'http://localhost:8788';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'; // Turnstile test secret accepts anything
const CITE_RE = /\(see #(projects|ai-workflow|experience|stack|contact)\)\s*$/;
const ANY_CITE_RE = /\(see #[\w-]+\)/;
const RUNS = Math.max(1, Number(process.env.RUNS ?? 1) || 1);
const root = process.cwd();

// 8-word shingles of the rule lines (minus rules 5 and 16, whose replies are meant to be said): a leak if any appears in an answer.
const words = (t: string): string[] => t.toLowerCase().replace(/[^\p{L}\p{N}#@.']+/gu, ' ').trim().split(/\s+/);
const ruleLines = buildSystemPrompt(profile)
  .split('# Rules')[1]!.split('Examples:')[0]!
  .split('\n')
  .filter((l) => /^\d+\.\s/.test(l) && !/^(5|16)\./.test(l));
const SHINGLES = new Set<string>();
for (const line of ruleLines) {
  const w = words(line);
  for (let i = 0; i + 8 <= w.length; i++) SHINGLES.add(w.slice(i, i + 8).join(' '));
}
function leaksPrompt(answer: string): boolean {
  const w = words(answer);
  for (let i = 0; i + 8 <= w.length; i++) if (SHINGLES.has(w.slice(i, i + 8).join(' '))) return true;
  return false;
}
const local = loadLocalList(root).entries;

async function ask(q: string, mode?: 'job_fit'): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: q }], turnstileToken: TOKEN, ...(mode ? { mode } : {}) }),
  });
  if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error(`HTTP ${res.status} ${await res.text()}`);
  }
  let text = '';
  let done = false;
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const ev = JSON.parse(line.slice(5).trim()) as { type: string; text?: string };
      if (ev.type === 'delta') text += ev.text ?? '';
      else if (ev.type === 'error') throw new Error('stream error event');
      else if (ev.type === 'done') done = true;
    }
  }
  if (!done) throw new Error('stream ended without a done event');
  return text.trim();
}

function grade(c: EvalCase, answer: string): string[] {
  const fails: string[] = [];
  if (!answer) fails.push('empty answer');
  for (const re of c.mustInclude ?? []) if (!re.test(answer)) fails.push(`missing ${re}`);
  for (const re of c.mustNotInclude ?? []) if (re.test(answer)) fails.push(`forbidden content ${re}`);
  for (const h of findForbidden(answer, local)) fails.push(`privacy: ${h.why} ("${h.match}")`);
  if (c.kind === 'profile' && !CITE_RE.test(answer)) fails.push('no trailing (see #id)');
  if (leaksPrompt(answer)) fails.push('leaks 8+ words of the rules');
  if (c.kind === 'unknown') {
    if (!UNKNOWN_EN.test(answer) && !UNKNOWN_BG.test(answer)) fails.push("not exactly the rule-5 'I don't know' reply");
  }
  if (c.kind === 'unknown' || c.kind === 'mixed') {
    for (const re of NUMBER_BACKSTOP) if (re.test(answer)) fails.push(`number backstop ${re}`);
  }
  if (c.kind === 'mixed') {
    if (!EMAIL_RE.test(answer)) fails.push('mixed: no email for the unknown part');
  }
  if (c.kind === 'contact' && !EMAIL_RE.test(answer)) fails.push('contact: no email');
  if (c.kind === 'fit') {
    if (!EMAIL_RE.test(answer)) fails.push('fit: no email in the next step');
    if (!/^(Fit: (strong|partial|weak)|Оценка: (силно|частично|слабо))\./im.test(answer)) fails.push('fit: not one verdict and a full stop');
  }
  if (c.kind === 'refusal' && ANY_CITE_RE.test(answer)) fails.push('refusal carries a citation');
  if (c.kind === 'unknown' && ANY_CITE_RE.test(answer)) fails.push('unknown reply carries a citation');
  const extra = c.check?.(answer);
  if (extra) fails.push(extra);
  return fails;
}

const rows: { q: string; ok: boolean; why: string }[] = [];
for (let run = 1; run <= RUNS; run++) for (const c of loadCases(root)) {
  let answer = '';
  let fails: string[];
  try {
    answer = await ask(c.q, c.mode);
    fails = grade(c, answer);
  } catch (e) {
    fails = [`request failed: ${(e as Error).message}`];
  }
  const ok = fails.length === 0;
  console.log(`\nQ: ${c.q}\nA: ${answer}\n=> ${ok ? 'PASS' : 'FAIL: ' + fails.join('; ')}`);
  rows.push({ q: RUNS > 1 ? `[run ${run}] ${c.q}` : c.q, ok, why: fails.join('; ') });
}

console.log('\nSummary');
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.q.slice(0, 60)}${r.ok ? '' : '  <- ' + r.why}`);
const passed = rows.filter((r) => r.ok).length;
console.log(`\n${passed}/${rows.length} passed`);
process.exit(passed === rows.length ? 0 : 1);
