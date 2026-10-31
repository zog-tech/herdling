#!/usr/bin/env bash
# Deploy site/public to Cloudflare Pages (project herdling-site).
# Needs CLOUDFLARE_API_TOKEN (Account > Cloudflare Pages > Edit) and CLOUDFLARE_ACCOUNT_ID.
# Locally they come from an env file outside git (HERDLING_SITE_ENV, default below).
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${HERDLING_SITE_ENV:-$HOME/.config/zoggyfin-site/cloudflare.env}"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi
: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN or create $ENV_FILE}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID or create $ENV_FILE}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID

scripts/check.sh

WRANGLER=(pnpm dlx wrangler@4.151.2)
PROJECT=herdling-site

# The first deploy needs the project.
if ! "${WRANGLER[@]}" pages project list 2>/dev/null | grep -qw "$PROJECT"; then
  "${WRANGLER[@]}" pages project create "$PROJECT" --production-branch main --force
fi

"${WRANGLER[@]}" pages deploy public --project-name "$PROJECT" --branch main --commit-dirty=true
