// Build guard: a production build must not ship a chat that cannot verify visitors.
import { loadEnv } from 'vite';

/**
 * Returns an error message when PUBLIC_TURNSTILE_SITE_KEY is empty and
 * ALLOW_MISSING_TURNSTILE is not "1"; otherwise null.
 * @param {Record<string, string | undefined>} env process env merged with .env.production
 * @returns {string | null}
 */
export function missingTurnstileError(env) {
  const key = (env.PUBLIC_TURNSTILE_SITE_KEY ?? '').trim();
  if (key !== '' || env.ALLOW_MISSING_TURNSTILE === '1') return null;
  return (
    'PUBLIC_TURNSTILE_SITE_KEY is empty: set it (Pages build variable or .env.production) or build with ' +
    'ALLOW_MISSING_TURNSTILE=1 to accept a chat that cannot verify visitors.'
  );
}

/** Astro integration: fails `astro build` when missingTurnstileError() reports a problem. */
export function requireTurnstileSiteKey() {
  return {
    name: 'require-turnstile-site-key',
    hooks: {
      'astro:build:start': () => {
        // The shell env wins over .env.production, as in Vite.
        const env = { ...loadEnv('production', process.cwd(), 'PUBLIC_'), ...process.env };
        const error = missingTurnstileError(env);
        if (error) throw new Error(error);
      },
    },
  };
}
