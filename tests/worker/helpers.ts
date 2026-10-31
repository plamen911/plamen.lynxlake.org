import type { D1Database } from '../../src/chat/server/env';

export async function resetTables(db: D1Database): Promise<void> {
  await db.batch(['spend', 'rate', 'questions'].map((t) => db.prepare(`DELETE FROM ${t}`)));
}
