// Minimal declarations for the Workers test runtime modules used by tests/worker.
// The full @cloudflare/workers-types globals clash with the DOM lib that the
// rest of the project type-checks against, so only what the tests use is declared.

declare module 'cloudflare:workers' {
  export const env: {
    DB: import('../../src/chat/server/env').D1Database;
    TEST_MIGRATIONS: { name: string; queries: string[] }[];
  };
}

declare module 'cloudflare:test' {
  export function applyD1Migrations(
    db: import('../../src/chat/server/env').D1Database,
    migrations: { name: string; queries: string[] }[],
    migrationsTableName?: string,
  ): Promise<void>;
}
