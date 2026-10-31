# plamen-site

Personal website for Plamen Markov: an Astro static site with a Cloudflare Pages Function chat.

## Scripts

- `npm run dev` - Astro dev server
- `npm run build` - static build to `dist/`
- `npm run preview` - serve `dist/` with `wrangler pages dev`
- `npm test` - Vitest
- `npm run typecheck` - `astro check` and `tsc --noEmit`
- `npm run check-public` - privacy guard (see below)
- `npm run ci` - typecheck, test, build, check-public (with `ALLOW_MISSING_TURNSTILE=1`)
- `npm run questions` - the last 100 questions asked in the chat (production D1, needs `wrangler login`)

## Build-time config

`.env.production` (committed) holds the public build-time values, empty in the repo and filled in at deploy, best as
Cloudflare Pages build variables (they take precedence over the file):

- `PUBLIC_TURNSTILE_SITE_KEY` - the Turnstile site key for the chat. **A production build fails while it is empty**,
  so a deploy cannot ship a chat that cannot verify visitors. To build without it (CI, tests, local checks) set
  `ALLOW_MISSING_TURNSTILE=1`; `npm run ci`, the page tests and `npm run evals:server` do.
- `PUBLIC_CF_ANALYTICS_TOKEN` - optional Cloudflare Web Analytics token; the beacon is rendered only when set.

The site URL (`https://plamen.lynxlake.org`) is `site` in `astro.config.mjs`; it drives the canonical link, `og:url`
and `og:image`. `public/og.png` (1200x630) and `public/favicon.ico` are generated from SVG by
`npx tsx scripts/make-og-image.ts` (run by hand, output committed); `public/favicon.svg` is the source monogram.

## Security headers

`public/_headers` sets, for every path: a Content-Security-Policy (`'self'`, plus `challenges.cloudflare.com` for the
Turnstile script and iframe and `static.cloudflareinsights.com` / `cloudflareinsights.com` for Web Analytics,
`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a
`Permissions-Policy` that disables camera, microphone and geolocation, and `X-Content-Type-Options: nosniff`. The CSP
has no `'unsafe-inline'`: Astro emits scripts as external files and `build.inlineStylesheets` is `'never'`; a page
test fails if an inline script, style element or style attribute appears. The CV PDF is exempt from the CSP so the
browser's PDF viewer works.

## Privacy guard

`npm run check-public` fails the build if a private fact appears in public output: the built site (`dist/`),
the chat's knowledge (the curated profile in `src/data/profile.ts`), the CV PDF in `public/cv/` (via `pdftotext`
from poppler-utils), and every git-tracked file.

It uses two lists:

- **Generic patterns** in `scripts/forbidden.ts`: shapes of phone numbers, rates, ages, birth dates,
  company-registration numbers and Skype. They contain no real private value and name no private topic.
- **A private local list**, never committed. It is loaded from the env var `FORBIDDEN_LOCAL_JSON` if set, otherwise
  from the gitignored `scripts/forbidden.local.json`. Each entry is either a literal, `{ "value": "…", "why": "…" }`
  (matched case- and spacing-insensitively), or a regex for a private topic,
  `{ "pattern": "…", "flags": "i", "why": "…" }`. The format is in `scripts/forbidden.local.example.json` (made-up
  values). Git-tracked files are checked against this list only.

Without a private list the guard still runs the generic patterns and prints a warning. In GitHub Actions, add the
list as the optional repository secret `FORBIDDEN_LOCAL_JSON` (the file's JSON content); hits from it are then
printed redacted, because Actions logs of a public repo are public.

Chat eval cases about private topics go in the gitignored `scripts/eval-cases.local.json` (format:
`scripts/eval-cases.local.example.json`); `npm run evals` merges them in when the file exists.

## Chat API

`POST /api/chat` (`functions/api/chat.ts`, logic in `src/chat/server/`) answers questions about Plamen with a Claude
model, grounded only in the system prompt built from `src/data/profile.ts`. It streams Server-Sent Events:
`data: {"type":"delta","text":"…"}` lines, then `data: {"type":"done"}`. Errors are JSON:
`invalid` 400, `verify` 401, `rate_limited` 429, `unavailable` 503.

Guards, in order: request validation (1-12 messages alternating user/assistant, starting and ending with the user;
user messages at most 600 chars, assistant messages at most 2000, 12000 in total), a Turnstile check that issues a
2-hour `chat_session` cookie (the token counts only if siteverify reports a hostname in `TURNSTILE_HOSTNAMES`, a
comma-separated allow-list in `wrangler.toml` where `*.x` allows subdomains of `x`; if it is empty the chat is
unavailable), an hourly rate limit per visitor (IPv6 by /64) and per session (`RATE_LIMIT_PER_HOUR`
each), and daily and monthly spend caps (`DAILY_CAP_USD`, `MONTHLY_CAP_USD`). Before the model is called, the
request's worst-case cost is reserved atomically within both caps; after the stream it is adjusted to the actual cost
from the token usage and the `PRICE_*_PER_MTOK` variables (in `wrangler.toml` `[vars]`; verify them against the
Anthropic pricing page before deploy) (released if the model fails before answering, kept if the
stream breaks or the visitor leaves). If a price is missing, or the input or output price is not above 0, the chat is
unavailable. Answers are capped at 400 tokens. A mid-stream model failure ends the stream with
`data: {"type":"error"}` instead of `done`.

State lives in D1 (`migrations/`): spend per day and month, rate buckets keyed by an HMAC of the visitor IP or of the session (the IP is
never stored), and the questions asked, kept for 30 days (older ones are purged when a question arrives and again when a request's
spend settles). `npm run questions` lists recent ones.

## Chat widget

`src/components/ChatWidget.astro` mounts the client (`src/chat/client/`) into `#chat-root` in the hero. Without JS the
static starter links and the email stay. The client streams the answer as text (only `(see #id)` citations become
in-page links), keeps the history within the API limits, and shows the email fallback line on any error. The
widget is titled as an AI assistant and its notice says answers are AI-generated and may be wrong, and that questions
are kept for 30 days without IP addresses. The email comes from `profile.email` via `data-email` on `#chat-root`.
After a starter question is answered, focus moves to the input. A failed Turnstile script load is retried on the next
question. Turnstile
is loaded on the first focus or click in the chat; the site key comes from the build-time env var
`PUBLIC_TURNSTILE_SITE_KEY` (in production a Pages build variable). Without it the chat still mounts, the API answers
`verify` 401 and the fallback shows. For local runs use the always-pass test key `1x00000000000000000000AA`, e.g.
`PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run evals:server`.

Local secrets go in `.dev.vars` (gitignored); `.dev.vars.example` lists the names. Worker tests (`tests/worker/`) run in
workerd via `@cloudflare/vitest-pool-workers` with the D1 migrations applied and never call the network.
