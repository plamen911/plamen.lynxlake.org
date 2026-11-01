# plamen-site

Personal website for Plamen Markov, live at <https://plamen.lynxlake.org> (and `www.`): a one-page Astro static site
with an AI chat about his work and a "Leave your email" contact form, both served by Cloudflare Pages Functions.

## Layout

- `src/data/profile.ts` - the curated public profile. The page **and** the chat's knowledge are generated from it, so
  edit facts here only.
- `src/components/` - the page sections (`Hero`, `Projects`/`ProjectCard`, `AiWorkflow`, `Experience`, `Stack`,
  `Contact`, `Footer`) and `ChatWidget`; `src/layouts/Base.astro` holds the document shell; `src/styles/tokens.css`
  the design tokens. Styling is plain CSS (tokens plus Astro-scoped component styles), no CSS framework.
- `src/chat/systemPrompt.ts` - builds the chat's system prompt from the profile.
- `src/chat/server/` - the chat and contact APIs; `functions/api/` are thin Pages Function wrappers.
- `src/chat/client/` - the chat widget, the contact dialog, the SSE parser and the Turnstile loader.
- `migrations/` - the D1 schema. `scripts/` - privacy guard, evals, OG-image generator.
- `public/` - `_headers`, favicons, `og.png` and the public CV PDF (`cv/Plamen_Markov_CV.pdf`, built from the private
  career knowledge base with the phone number and some details left out).

## Scripts

- `npm run dev` - Astro dev server (static page only; the APIs need `preview`)
- `npm run build` - static build to `dist/`
- `npm run preview` - serve `dist/` with `wrangler pages dev`, Functions and a local D1 included
- `npm test` - Vitest: a `unit` project (`tests/*.test.ts`, node or happy-dom) and a `worker` project
  (`tests/worker/`, workerd with the D1 migrations applied; no network)
- `npm run typecheck` - `astro check` and `tsc --noEmit`
- `npm run check-public` - privacy guard (see below)
- `npm run ci` - typecheck, test, build, check-public (with `ALLOW_MISSING_TURNSTILE=1`); GitHub Actions runs it on
  every push
- `npm run evals:server` - builds and serves the site locally for the evals: Turnstile test keys, the real
  `ANTHROPIC_API_KEY` from `.dev.vars`, a generated `SESSION_SECRET` and `RATE_LIMIT_PER_HOUR=200`. Apply the local
  D1 schema first: `npx wrangler d1 migrations apply plamen-site --local`
- `npm run evals` - asks the running local chat a set of real questions (grounded answers, unknown facts, refusals,
  prompt injection, Bulgarian, contact requests) and grades the answers; spends real (small) API money. `RUNS=3`
  repeats every case.
- `npm run questions` - the last 100 questions asked in the chat, from the production D1 (needs `wrangler login`)

## Deployment

Cloudflare Pages project `plamen-site`, connected to this GitHub repo: every push to `main` builds (`npm run build`,
output `dist`) and deploys to production within a minute or two. The custom domains `plamen.lynxlake.org` and
`www.plamen.lynxlake.org` are CNAMEs to `plamen-site.pages.dev`; the `lynxlake.org` DNS zone itself stays with the
original host. Bindings and non-secret variables come from `wrangler.toml` (`pages_build_output_dir` makes it the
source of truth): the D1 database `plamen-site` as `DB`, and `[vars]`.

Secrets (`npx wrangler pages secret put <NAME> --project-name plamen-site`; a new value takes effect on the next
deploy):

- `ANTHROPIC_API_KEY` - a key for this site only, in an Anthropic workspace with its own monthly spend limit
- `TURNSTILE_SECRET` - the Turnstile widget's secret key
- `SESSION_SECRET` - random, e.g. `openssl rand -hex 32`; signs the chat session cookie and keys the visitor hashes
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` - optional for the chat (question notifications), required for the contact
  form (see below)

Local secrets go in `.dev.vars` (gitignored); `.dev.vars.example` lists the names.

## Build-time config

`.env.production` (committed) holds the two public build-time values; Cloudflare Pages build variables would take
precedence over it:

- `PUBLIC_TURNSTILE_SITE_KEY` - the Turnstile site key. **A production build fails while it is empty**, so a deploy
  cannot ship a chat that cannot verify visitors. To build without it (CI, tests, local checks) set
  `ALLOW_MISSING_TURNSTILE=1`; `npm run ci` and the page tests do. Cloudflare's always-pass test key is
  `1x00000000000000000000AA`.
- `PUBLIC_CF_ANALYTICS_TOKEN` - optional Cloudflare Web Analytics token; the beacon is rendered only when set.

The site URL is `site` in `astro.config.mjs`; it drives the canonical link, `og:url` and `og:image`. `public/og.png`
(1200x630) and `public/favicon.ico` are generated from SVG by `npx tsx scripts/make-og-image.ts` (run by hand, output
committed); `public/favicon.svg` is the source monogram.

## Security headers

`public/_headers` sets, for every path: a Content-Security-Policy (`'self'`, plus `challenges.cloudflare.com` for the
Turnstile script and iframe and `static.cloudflareinsights.com` / `cloudflareinsights.com` for Web Analytics,
`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a
`Permissions-Policy` that disables camera, microphone and geolocation, and `X-Content-Type-Options: nosniff`. The CSP
has no `'unsafe-inline'`: Astro emits scripts as external files and `build.inlineStylesheets` is `'never'`; a page
test fails if an inline script, style element or style attribute appears. The CV PDF is exempt from the CSP so the
browser's PDF viewer works.

## Privacy guard

`npm run check-public` fails the build if a private fact appears in public output: the built site (`dist/`), the
chat's system prompt (built from `src/data/profile.ts`), the CV PDF in `public/cv/` (via `pdftotext` from
poppler-utils), and every git-tracked file.

It uses two lists:

- **Generic patterns** in `scripts/forbidden.ts`: shapes of phone numbers, rates, ages, birth dates,
  company-registration numbers and Skype. They contain no real private value and name no private topic.
- **A private local list**, never committed. It is loaded from the env var `FORBIDDEN_LOCAL_JSON` if set, otherwise
  from the gitignored `scripts/forbidden.local.json`. Each entry is either a literal, `{ "value": "…", "why": "…" }`
  (matched case- and spacing-insensitively), or a regex for a private topic,
  `{ "pattern": "…", "flags": "i", "why": "…" }`. The format is in `scripts/forbidden.local.example.json` (made-up
  values). Git-tracked files are checked against this list only.

Without a private list the guard still runs the generic patterns and prints a warning. In GitHub Actions, add the
list as the optional repository secret `FORBIDDEN_LOCAL_JSON` (the file's JSON content):

```bash
gh secret set FORBIDDEN_LOCAL_JSON --repo plamen911/plamen.lynxlake.org < scripts/forbidden.local.json
```

Hits from it are then printed redacted, because Actions logs of a public repo are public.

Chat eval cases about private topics go in the gitignored `scripts/eval-cases.local.json` (format:
`scripts/eval-cases.local.example.json`); `npm run evals` merges them in when the file exists.

## Chat API

`POST /api/chat` (`functions/api/chat.ts`, logic in `src/chat/server/handler.ts`) answers questions about Plamen with
`CHAT_MODEL` (Claude Haiku 5.5, thinking disabled, effort low, answers capped at 400 tokens), grounded only in the
system prompt built from `src/data/profile.ts` (sent with prompt caching). The prompt's rules keep the assistant on
Plamen's profile, make it cite the page section an answer comes from as `(see #id)`, answer "I don't know — please ask
Plamen at …" for anything the profile doesn't cover (rates, age, personal details), refuse unrelated tasks and
instruction-injection attempts, reply in the language of the question (English or Bulgarian), and point visitors who
want to reach Plamen to his email or the contact form.

It streams Server-Sent Events: `data: {"type":"delta","text":"…"}` lines, then `data: {"type":"done"}`; a model
failure mid-stream, or an answer with no text, ends with `data: {"type":"error"}` instead. Errors are JSON:
`invalid` 400, `verify` 401, `rate_limited` 429, `unavailable` 503.

Guards, in order: request validation (1-12 messages alternating user/assistant, starting and ending with the user;
user messages at most 600 chars, assistant messages at most 2000, 12000 in total), a Turnstile check that issues a
2-hour `chat_session` cookie (the token counts only if siteverify reports a hostname in `TURNSTILE_HOSTNAMES`, a
comma-separated allow-list in `wrangler.toml` where `*.x` allows subdomains of `x`; if it is empty the chat is
unavailable), an hourly rate limit per visitor (IPv6 by /64) and per session (`RATE_LIMIT_PER_HOUR` each), and daily
and monthly spend caps (`DAILY_CAP_USD`, `MONTHLY_CAP_USD`). Before the model is called, the request's worst-case cost
is reserved atomically within both caps; after the stream it is adjusted to the actual cost from the token usage and
the `PRICE_*_PER_MTOK` variables (in `wrangler.toml` `[vars]`; verify them against the Anthropic pricing page) -
released if the model fails before answering, kept if the stream breaks or the visitor leaves. If a price is missing,
or the input or output price is not above 0, the chat is unavailable.

State lives in D1 (`migrations/`): spend per day and month, rate buckets keyed by an HMAC of the visitor IP or of the
session (the IP is never stored), and the questions asked, kept for 30 days (older ones are purged when a question
arrives and again when a request's spend settles). `npm run questions` lists recent ones.

### Telegram notifications

When `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, every chat question is also sent to that Telegram chat
(`src/chat/server/notify.ts`): the host, "new visitor" or "follow-up", the UTC time and the question text - never the
IP. Sending happens in the background and never affects the chat's answer. To set the bot up: create it with
@BotFather, send it any message from your Telegram account, then read the chat id from
`https://api.telegram.org/bot<token>/getUpdates` and store both values as secrets.

## Contact API

`POST /api/contact` (`functions/api/contact.ts`, logic in `src/chat/server/contact.ts`) takes
`{ email, name, message, turnstileToken? }` from the "Leave your email" form and forwards it to the Telegram chat
above. It is **not stored** anywhere and the IP is never sent. It answers 200 `{ok:true}` only once Telegram has
accepted the message, so a visitor is never told it was sent when it wasn't; without the Telegram secrets, or if
Telegram fails or times out (8 s), it answers `unavailable` 503.

Validation: all three fields are required; email at most 254 chars and a single plain `local@domain.tld` address
(no lists, display names or spaces); name at most 100 chars on one line; message at most 1000 chars (newlines
allowed); no control characters, line separators or bidi overrides; body at most 8 KB. Auth is the same as the chat:
a valid `chat_session` cookie, or a Turnstile token (which issues the cookie). Limits: 3 requests per visitor per
hour, 3 per session, and 50 per UTC day across all visitors; over a limit it answers `rate_limited` 429.

## Chat widget

`src/components/ChatWidget.astro` mounts the client (`src/chat/client/chat.ts`) into `#chat-root` in the hero. Without
JS the static starter links and the email stay. The widget is titled as an AI assistant; its notice says answers are
AI-generated and may be wrong, that questions are kept for 30 days without IP addresses, and that an email left in the
form goes only to Plamen and isn't stored on the site. The email address comes from `profile.email` via `data-email`
on `#chat-root`.

The client streams the answer as text (only `(see #id)` citations become in-page links), keeps the history within the
API limits, and shows the email fallback line on any error. After a starter question is answered, focus moves to the
input. Turnstile is loaded on the first focus or click in the chat (managed, interaction-only); a failed script load
is retried on the next question. Without a site key the chat still mounts, the API answers `verify` 401 and the
fallback shows.

"Want Plamen to get back to you? Leave your email" under the chat opens a native `<dialog>` modal (focus trap, Esc,
backdrop click, × and Cancel close it; focus returns to the link). The form checks the email shape and that the name
and message are filled in, cleans control characters, reuses the chat's session and Turnstile, and shows "Thanks —
Plamen will reply by email." or, on failure, keeps the form open and points to his email.
