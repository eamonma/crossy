-- Bind login credentials to the least-privilege service roles on hosted Postgres.
--
-- The committed migration (packages/db/drizzle/0001_real_schema.sql) creates crossy_api and
-- crossy_session as NOLOGIN roles carrying only their least-privilege grants (INV-7). NOLOGIN
-- means they hold privileges but cannot open a connection, which is deliberate: the privilege
-- surface is committed to the repo, the login secret is provisioned out of band and never is.
--
-- This grants each role LOGIN plus a password so the api and session services connect AS the
-- role they own. The service then inherits exactly that role's grants and BYPASSRLS, and
-- nothing else. Run as a privileged role (Supabase `postgres`) over the DIRECT connection:
--
--   psql "$MIGRATION_DATABASE_URL" \
--     -v api_password="$CROSSY_API_DB_PASSWORD" \
--     -v session_password="$CROSSY_SESSION_DB_PASSWORD" \
--     -f deploy/bind-service-roles.sql
--
-- (deploy/bind-service-roles.sh wraps this and reads the values from the environment.)
--
-- Idempotent: ALTER ROLE just sets state, so re-running rotates the passwords safely. It
-- creates and deletes nothing. It CANNOT run until the Supabase project and its roles exist
-- (apply deploy/migrate.ts first).
\set ON_ERROR_STOP on

ALTER ROLE crossy_api     WITH LOGIN PASSWORD :'api_password';
ALTER ROLE crossy_session WITH LOGIN PASSWORD :'session_password';

-- Confirm both roles can now log in (rolcanlogin = t) and still bypass the RLS tripwire.
SELECT rolname, rolcanlogin, rolbypassrls
FROM pg_roles
WHERE rolname IN ('crossy_api', 'crossy_session')
ORDER BY rolname;
