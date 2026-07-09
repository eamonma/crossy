#!/usr/bin/env bash
# Wrap deploy/bind-service-roles.sql: read the two service passwords and the privileged
# DIRECT connection string from the environment, then bind LOGIN to the NOLOGIN service
# roles. Passwords never touch the repo or the command line history of another process.
#
# WHEN THE OWNER RUNS IT (cannot run until the Supabase project exists):
#   export MIGRATION_DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
#   export CROSSY_API_DB_PASSWORD='...'        # strong random, e.g. openssl rand -base64 24
#   export CROSSY_SESSION_DB_PASSWORD='...'    # strong random, distinct from the api one
#   ./deploy/bind-service-roles.sh
#
# Afterwards, set each service's Railway DATABASE_URL to the pooled connection for that role:
#   api     : postgresql://crossy_api:<api_pw>@<pooler-host>:5432/postgres
#   session : postgresql://crossy_session:<session_pw>@<pooler-host>:5432/postgres
# (Services should use the Supabase pooler; only THIS script and migrate.ts use the direct
# connection. See deploy/README.md.)
set -euo pipefail

: "${MIGRATION_DATABASE_URL:?set MIGRATION_DATABASE_URL to the hosted Postgres DIRECT DSN (privileged)}"
: "${CROSSY_API_DB_PASSWORD:?set CROSSY_API_DB_PASSWORD to the crossy_api login password}"
: "${CROSSY_SESSION_DB_PASSWORD:?set CROSSY_SESSION_DB_PASSWORD to the crossy_session login password}"

command -v psql >/dev/null 2>&1 || {
  echo "error: psql not found. Install the Postgres client." >&2
  exit 1
}

if [[ "$MIGRATION_DATABASE_URL" == *pooler* || "$MIGRATION_DATABASE_URL" == *:6543* ]]; then
  echo "error: use the DIRECT connection (port 5432), not the pooler, for role changes." >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
psql "$MIGRATION_DATABASE_URL" \
  -v api_password="$CROSSY_API_DB_PASSWORD" \
  -v session_password="$CROSSY_SESSION_DB_PASSWORD" \
  -f "$here/bind-service-roles.sql"

echo "service roles bound. Set each Railway DATABASE_URL to its role's pooled connection."
