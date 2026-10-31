#!/usr/bin/env bash
# Local server for `npm run evals`. Reads ANTHROPIC_API_KEY from .dev.vars (never printed).
# The Turnstile secret below is Cloudflare's public always-pass TEST secret.
# RATE_LIMIT_PER_HOUR is raised to 200 so the eval run is not rate limited.
# Prices and TURNSTILE_HOSTNAMES come from [vars] in wrangler.toml. The test secret's
# siteverify reply reports hostname example.com, so it is allowed here as well.
set -euo pipefail
cd "$(dirname "$0")/.."
ALLOW_MISSING_TURNSTILE=1 npm run build
exec npx wrangler pages dev dist --port 8788 \
  --binding TURNSTILE_SECRET=1x0000000000000000000000000000000AA \
  --binding SESSION_SECRET="$(openssl rand -hex 32)" \
  --binding RATE_LIMIT_PER_HOUR=200 \
  --binding TURNSTILE_HOSTNAMES=localhost,example.com
