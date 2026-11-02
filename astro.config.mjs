import { defineConfig } from 'astro/config';
import { requireTurnstileSiteKey } from './scripts/require-turnstile.mjs';

export default defineConfig({
  site: 'https://plamen.lynxlake.org',
  output: 'static',
  // Every stylesheet is an external file, so the CSP in public/_headers needs no 'unsafe-inline' for styles.
  build: { inlineStylesheets: 'never' },
  // Small scripts stay external files too, as the CSP allows no inline script.
  vite: { build: { assetsInlineLimit: 0 } },
  // A production build fails while PUBLIC_TURNSTILE_SITE_KEY is empty, unless ALLOW_MISSING_TURNSTILE=1.
  integrations: [requireTurnstileSiteKey()],
});
