import type { D1Database } from './env';

export const QUESTION_RETENTION_DAYS = 30;

const cutoffIso = (now: Date): string => new Date(now.getTime() - QUESTION_RETENTION_DAYS * 86_400_000).toISOString();

const purgeStatement = (db: D1Database, now: Date) => db.prepare('DELETE FROM questions WHERE ts < ?').bind(cutoffIso(now));

/** Stores the visitor's question (text only) and deletes questions older than 30 days. */
export async function logQuestion(db: D1Database, now: Date, question: string): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO questions (ts, question) VALUES (?, ?)').bind(now.toISOString(), question),
    purgeStatement(db, now),
  ]);
}

/** Deletes questions older than 30 days. Also run when spend settles, so the purge does not wait for a new question. */
export async function purgeQuestions(db: D1Database, now: Date): Promise<void> {
  await purgeStatement(db, now).run();
}
