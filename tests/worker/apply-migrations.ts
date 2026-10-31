import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// Runs before each worker test file; already-applied migrations are skipped.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
