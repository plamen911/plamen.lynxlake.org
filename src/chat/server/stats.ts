import { VIEW_KEY } from '../../data/clicks';
import type { Env } from './env';

/** Days of history /api/stats returns; chat questions and ratings are only kept for 30. */
export const STATS_DAYS = 30;

export interface StatsDay {
  day: string;
  views: number;
  cv: number;
  email: number;
  linkedin: number;
  github: number;
  projects: number;
  chat: number;
  rated_up: number;
  rated_down: number;
}

const COUNTERS = ['views', 'cv', 'email', 'linkedin', 'github', 'projects', 'chat', 'rated_up', 'rated_down'] as const;

const json = (status: number, body: unknown, cache: string): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
  });

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

/** The column a click link is summed into. */
const columnFor = (link: string): keyof StatsDay | null => {
  if (link === VIEW_KEY) return 'views';
  if (link === 'cv' || link === 'email' || link === 'linkedin' || link === 'github') return link;
  return link.includes(':') ? 'projects' : null;
};

/**
 * GET /api/stats: totals per UTC day for the last STATS_DAYS days - page views, clicks on the
 * CV, email, LinkedIn, GitHub and project links, chat questions, and rated answers. Counts only:
 * no question text, no visitor id, nothing about a person. Public by design, cached for 5 minutes.
 */
export async function handleStats(env: Env, now: Date): Promise<Response> {
  if (!env.DB) return json(503, { error: 'unavailable' }, 'no-store');

  const from = new Date(now.getTime() - (STATS_DAYS - 1) * 86_400_000);
  const fromDay = dayOf(from);
  const days = new Map<string, StatsDay>();
  for (let t = from.getTime(); t <= now.getTime(); t += 86_400_000) {
    const day = dayOf(new Date(t));
    days.set(day, { day, views: 0, cv: 0, email: 0, linkedin: 0, github: 0, projects: 0, chat: 0, rated_up: 0, rated_down: 0 });
  }

  try {
    const [clicks, questions, feedback] = await env.DB.batch<Record<string, unknown>>([
      env.DB.prepare('SELECT day, link, count FROM clicks WHERE day >= ?').bind(fromDay),
      env.DB.prepare('SELECT substr(ts, 1, 10) AS day, COUNT(*) AS n FROM questions WHERE ts >= ? GROUP BY day').bind(fromDay),
      env.DB.prepare('SELECT substr(ts, 1, 10) AS day, vote, COUNT(*) AS n FROM feedback WHERE ts >= ? GROUP BY day, vote').bind(fromDay),
    ]);
    for (const r of clicks.results) {
      const row = days.get(String(r.day));
      const col = columnFor(String(r.link));
      if (row && col) (row[col] as number) += Number(r.count);
    }
    for (const r of questions.results) {
      const row = days.get(String(r.day));
      if (row) row.chat += Number(r.n);
    }
    for (const r of feedback.results) {
      const row = days.get(String(r.day));
      if (row) row[r.vote === 'up' ? 'rated_up' : 'rated_down'] += Number(r.n);
    }
  } catch (err) {
    console.error('stats: D1 error', err instanceof Error ? err.message : 'unknown');
    return json(503, { error: 'unavailable' }, 'no-store');
  }

  const daily = [...days.values()];
  const totals = Object.fromEntries(COUNTERS.map((c) => [c, daily.reduce((sum, d) => sum + d[c], 0)]));
  return json(200, { generated: now.toISOString(), days: STATS_DAYS, totals, daily }, 'public, max-age=300');
}
