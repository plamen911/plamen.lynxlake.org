import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)));

  return {
    test: {
      projects: [
        {
          test: {
            name: 'unit',
            include: ['tests/*.test.ts'],
            environment: 'node',
          },
        },
        {
          // Runs in workerd with a local D1. Bindings are declared here rather
          // than read from wrangler.toml so that .dev.vars is never loaded.
          plugins: [
            cloudflareTest({
              miniflare: {
                // The pool's bundled workerd supports dates up to 2026-08-22
                // (wrangler.toml uses 2026-10-01; nothing used here differs).
                compatibilityDate: '2026-08-22',
                compatibilityFlags: ['nodejs_compat'],
                d1Databases: ['DB'],
                bindings: { TEST_MIGRATIONS: migrations },
              },
            }),
          ],
          test: {
            name: 'worker',
            include: ['tests/worker/**/*.test.ts'],
            setupFiles: ['./tests/worker/apply-migrations.ts'],
          },
        },
      ],
    },
  };
});
