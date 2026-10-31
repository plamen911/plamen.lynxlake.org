import { defineConfig } from 'astro/config';
import { requireTurnstileSiteKey } from './scripts/require-turnstile.mjs';

export default defineConfig({
  site: 'https://plamen.lynxlake.org',
  output: 'static',
  // Every stylesheet is an external file, so the CSP in public/_headers needs no 'unsafe-inline' for styles.
  build: { inlineStylesheets: 'never' },
  // A production build fails while PUBLIC_TURNSTILE_SITE_KEY is empty, unless ALLOW_MISSING_TURNSTILE=1.
  integrations: [requireTurnstileSiteKey()],
});
