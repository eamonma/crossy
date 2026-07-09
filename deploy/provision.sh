#!/usr/bin/env bash
# Crossy Wave 2.2 provisioning: create-only, idempotent Railway bootstrap.
#
# WHAT IT DOES, when the OWNER runs it with an authenticated Railway CLI (`railway login`):
# creates ONE new project `crossy` with three services (api, session, web), sets every
# variable (non-secret inline, INTERNAL_BEARER_TOKEN generated strong-random and shared by
# api+session, DATABASE_URL / Supabase values as clearly marked placeholders), assigns the
# us-east region (co-located with Supabase us-east-1), creates public domains for api /
# session / web, and connects each service to its GHCR image. Private networking is
# automatic on Railway (SP3): `session.railway.internal` is reachable service-to-service
# and NXDOMAIN publicly, so there is nothing to "enable".
#
# CREATE-ONLY, NON-DESTRUCTIVE by construction:
#   - It REFUSES to run if a project named `crossy` already exists. It never edits or
#     deletes an existing project. To re-provision, delete `crossy` by hand first.
#   - It runs no delete/down command anywhere.
#
# It follows the CLI pattern validated end to end in reports/spikes/sp3-railway-reality-check.md.
# Run `./deploy/provision.sh --dry-run` first to print the exact plan without executing.
#
# This script does NOT create any secret in GitHub, GHCR, or Supabase, and it cannot create
# the Supabase project. See deploy/README.md for the owner-action checklist and the wiring
# order (the Supabase-gated placeholders must be replaced before the services boot).
set -euo pipefail

# --- configuration ----------------------------------------------------------------------
PROJECT_NAME="crossy"
REGISTRY="ghcr.io/eamonma"          # GHCR owner; images are crossy-{api,session,web}
IMAGE_TAG="${IMAGE_TAG:-latest}"    # provisioning pins :latest; CI redeploys roll it
REGION="us-east"                    # Railway region alias (SP3); co-located with Supabase
DEFAULT_REGION_TO_ZERO="us-west"    # `railway scale` is ADDITIVE (SP3): zero the default.
                                    # CLI v5 region names: us-east, us-west, eu-west,
                                    # southeast-asia (v4 called the default sfo).

# Ports. The public domain of each service targets its PORT. The session ALSO listens on
# INTERNAL_PORT for /internal, which gets NO domain, so it is private-network only.
API_PORT=8080
SESSION_PORT=8081
SESSION_INTERNAL_PORT=8082
WEB_PORT=8080

# Secrets and Supabase-gated values: read from the environment if the owner exported them,
# otherwise write a loud placeholder the services will visibly fail on until it is replaced.
PLACEHOLDER="REPLACE_ME_after_supabase_project_exists"
SUPABASE_ISSUER="${SUPABASE_ISSUER:-$PLACEHOLDER}"          # https://<ref>.supabase.co/auth/v1
DATABASE_URL_API="${DATABASE_URL_API:-$PLACEHOLDER}"        # crossy_api login role DSN
DATABASE_URL_SESSION="${DATABASE_URL_SESSION:-$PLACEHOLDER}" # crossy_session login role DSN

# --- dry-run plumbing -------------------------------------------------------------------
DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    # Redact secret values in the printed plan: DATABASE_URL carries a password and the
    # bearer is a shared secret. The live path executes the real values untouched.
    printf '  + %s\n' "$*" |
      sed -E 's/(DATABASE_URL=|INTERNAL_BEARER_TOKEN=)[^[:space:]]+/\1<redacted>/g'
  else
    "$@"
  fi
}

note() { printf '\n== %s\n' "$*"; }

# --- preflight --------------------------------------------------------------------------
command -v railway >/dev/null 2>&1 || {
  echo "error: railway CLI not found. Install it and run 'railway login' first." >&2
  exit 1
}

if [[ $DRY_RUN -eq 0 ]]; then
  railway whoami >/dev/null 2>&1 || {
    echo "error: not logged in. Run 'railway login' first." >&2
    exit 1
  }
fi

# Strong random shared internal bearer (DESIGN.md section 6). Generated once, set on api+session.
INTERNAL_BEARER_TOKEN="$(openssl rand -hex 32)"

note "Crossy provisioning plan ($([[ $DRY_RUN -eq 1 ]] && echo DRY RUN || echo LIVE))"
cat <<EOF
  project           : $PROJECT_NAME  (create-only; refuses if it already exists)
  services          : api, session, web
  region            : $REGION  (default region '$DEFAULT_REGION_TO_ZERO' zeroed; scale is additive)
  images            : $REGISTRY/$PROJECT_NAME-{api,session,web}:$IMAGE_TAG
  internal bearer   : generated ($(printf '%.8s' "$INTERNAL_BEARER_TOKEN")... , 32 bytes hex)
  SUPABASE_ISSUER   : $([[ "$SUPABASE_ISSUER" == "$PLACEHOLDER" ]] && echo 'PLACEHOLDER (set later)' || echo 'from env')
  DATABASE_URL (api): $([[ "$DATABASE_URL_API" == "$PLACEHOLDER" ]] && echo 'PLACEHOLDER (set later)' || echo 'from env')
  DATABASE_URL (ses): $([[ "$DATABASE_URL_SESSION" == "$PLACEHOLDER" ]] && echo 'PLACEHOLDER (set later)' || echo 'from env')
EOF

# --- create-only guard ------------------------------------------------------------------
# Refuse to touch an existing project. `railway list` prints the workspace's projects.
if [[ $DRY_RUN -eq 0 ]]; then
  if railway list 2>/dev/null | grep -qiE "(^|[[:space:]])${PROJECT_NAME}([[:space:]]|\$)"; then
    echo "error: a project named '$PROJECT_NAME' already exists. This script is create-only" >&2
    echo "       and never edits or deletes an existing project. Delete it by hand to re-run." >&2
    exit 1
  fi
fi

# --- project + services -----------------------------------------------------------------
note "Create project and link the production environment"
WORKSPACE_ARG=()
[[ -n "${RAILWAY_WORKSPACE_ID:-}" ]] && WORKSPACE_ARG=(--workspace "$RAILWAY_WORKSPACE_ID")
run railway init --name "$PROJECT_NAME" "${WORKSPACE_ARG[@]}"
run railway link -p "$PROJECT_NAME" -e production

# CLI v5 prompts interactively for optional extras here (service type, an "Enter a
# variable" prompt); pick Empty Service and Esc past the variables. The script sets
# every variable itself below.
note "Add the three services"
run railway add --service api
run railway add --service session
run railway add --service web

# --- domains (capture the generated hostnames) ------------------------------------------
# Create the public domain for each service and read back its hostname, because api's
# SESSION_WS_BASE and CORS_ORIGIN depend on the session and web hostnames respectively.
note "Create public domains (api REST, session WS, web static)"
if [[ $DRY_RUN -eq 1 ]]; then
  run railway domain -s api --port "$API_PORT"
  run railway domain -s session --port "$SESSION_PORT"
  run railway domain -s web --port "$WEB_PORT"
  API_HOST="api-<generated>.up.railway.app"
  SESSION_HOST="session-<generated>.up.railway.app"
  WEB_HOST="web-<generated>.up.railway.app"
else
  API_HOST="$(railway domain -s api --port "$API_PORT" --json | grep -oE '[a-z0-9.-]+\.up\.railway\.app' | head -1)"
  SESSION_HOST="$(railway domain -s session --port "$SESSION_PORT" --json | grep -oE '[a-z0-9.-]+\.up\.railway\.app' | head -1)"
  WEB_HOST="$(railway domain -s web --port "$WEB_PORT" --json | grep -oE '[a-z0-9.-]+\.up\.railway\.app' | head -1)"
fi
echo "  api     -> https://$API_HOST"
echo "  session -> wss://$SESSION_HOST"
echo "  web     -> https://$WEB_HOST"

# --- variables (--skip-deploys: set everything, deploy once at the end) ------------------
# api: public REST. SESSION_WS_BASE points at the session's public WS domain; CORS_ORIGIN at
# the web origin; SESSION_INTERNAL_BASE at the session's PRIVATE internal port.
note "Set api variables"
run railway variables -s api --skip-deploys \
  --set "PORT=$API_PORT" \
  --set "SUPABASE_ISSUER=$SUPABASE_ISSUER" \
  --set "DATABASE_URL=$DATABASE_URL_API" \
  --set "SESSION_WS_BASE=wss://$SESSION_HOST" \
  --set "CORS_ORIGIN=https://$WEB_HOST" \
  --set "SESSION_INTERNAL_BASE=http://session.railway.internal:$SESSION_INTERNAL_PORT" \
  --set "INTERNAL_BEARER_TOKEN=$INTERNAL_BEARER_TOKEN"

# session: public WS on PORT, private /internal on INTERNAL_PORT, bind 0.0.0.0 for the
# private network. Same INTERNAL_BEARER_TOKEN as api.
note "Set session variables"
run railway variables -s session --skip-deploys \
  --set "PORT=$SESSION_PORT" \
  --set "INTERNAL_PORT=$SESSION_INTERNAL_PORT" \
  --set "HOST=0.0.0.0" \
  --set "SUPABASE_ISSUER=$SUPABASE_ISSUER" \
  --set "DATABASE_URL=$DATABASE_URL_SESSION" \
  --set "INTERNAL_BEARER_TOKEN=$INTERNAL_BEARER_TOKEN"

# web: static client. It needs nothing but its listen port (client reads api/game/token
# from the URL at runtime; no build-time config).
note "Set web variables"
run railway variables -s web --skip-deploys \
  --set "PORT=$WEB_PORT"

# --- region (scale is additive: zero the default, then place in us-east) -----------------
note "Place every service in region '$REGION' (single replica)"
for svc in api session web; do
  run railway scale -s "$svc" "$DEFAULT_REGION_TO_ZERO=0" "$REGION=1"
done

# --- connect GHCR image sources ---------------------------------------------------------
# The repo is private, so these images are private. Railway needs registry pull credentials
# (Pro supports private registries). The CLI CANNOT set those credentials, so this connect
# succeeds but the pull fails until the owner adds a GHCR pull credential in the dashboard:
#   Service > Settings > Source > (image) > Private registry credentials
#     username: a GitHub username (or a machine account)
#     password: a PAT / token with read:packages on ghcr.io/eamonma/crossy-*
# See deploy/README.md. Do NOT work around this by making the packages public without a
# deliberate decision (it is called out there as an open decision, not the default).
note "Connect each service to its GHCR image"
run railway service source connect --image "$REGISTRY/$PROJECT_NAME-api:$IMAGE_TAG" -s api
run railway service source connect --image "$REGISTRY/$PROJECT_NAME-session:$IMAGE_TAG" -s session
run railway service source connect --image "$REGISTRY/$PROJECT_NAME-web:$IMAGE_TAG" -s web

note "Done."
cat <<EOF

Next, in order (see deploy/README.md for exact locations):
  1. Add a GHCR pull credential to EACH service (dashboard; CLI cannot).
  2. Replace the placeholder variables once the Supabase project exists:
       SUPABASE_ISSUER, DATABASE_URL (api = crossy_api role, session = crossy_session role).
  3. Apply migrations to hosted Postgres and bind the service login roles
       (deploy/migrate.ts, deploy/bind-service-roles.sql).
  4. Mint a Railway project token, add it to GitHub as the RAILWAY_TOKEN secret.
  5. Trigger the deploy workflow (or push to main) to roll the images.
  6. Run deploy/verify.mjs against the three public hostnames above.

The generated INTERNAL_BEARER_TOKEN is now stored on api and session in Railway. It is
never printed in full (the dry-run plan redacts secret values); it lives in Railway
variables, not in this repo.
EOF
