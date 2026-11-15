---
status: descriptive
verified: 8eced56
---

# Crossy deploy (Wave 2.2)

Production services build directly from the private `eamonma/crossy` GitHub repository.
Each service follows `main`, uses `apps/<service>/Dockerfile` with the repository root as
build context, and has **Wait for CI** enabled. This works on Railway Hobby without private
registry credentials. The repository and container images remain private.

The `Deploy` GitHub workflow applies migrations. Railway waits for that workflow and the
other GitHub Actions checks to finish successfully before building and deploying the commit.
Its migration concurrency group never cancels queued runs. `main` still requires a PR and
green checks. No laptop upload or Railway CI token is needed.

## Topology

```
  phone / browser
        |  HTTPS (static)          |  HTTPS (REST, JWT)         |  WSS (JWT on first frame)
        v                          v                            v
  web  (nginx static)        api  (Hono REST)             session  (ws + actors)
                                   |   private network:          ^   PORT  8081  public (WS + health)
                                   |   POST /internal ---------->|   INTERNAL_PORT 8082  private only
                                   |   session.railway.internal:8082
        \__________________________|____________________________/
                                   |
                          Supabase Postgres (us-east-1)
                api connects as crossy_api, session as crossy_session
                both verify Supabase JWTs offline against the published JWKS
```

Private networking is automatic on Railway (SP3): `session.railway.internal` resolves
service-to-service and is NXDOMAIN publicly. The `session` service is the only one with a
second, domain-less port (`INTERNAL_PORT`); `/internal` is served ONLY there, so it is
reachable over the private network but returns 404 on the public WS domain. `api` and `web`
have one public port each.

## Environment variable matrix

Legend: Secret = must never be committed; Supabase-gated = final value is unknown until the
Supabase project exists (a placeholder is written until then).

### api

| Variable                | Secret | Supabase-gated | Value / meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                  | no     | no             | `8080`. Public REST port; the api domain targets it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `SUPABASE_ISSUER`       | no     | yes            | `https://<ref>.supabase.co/auth/v1`. JWKS URL derives from it. Always the ref domain, even with a Supabase custom domain: the custom domain fronts the API but tokens keep the ref-domain `iss` (verified against `/auth/v1/.well-known/openid-configuration` on the custom domain, which declares the ref-domain issuer). Setting this to the custom domain breaks every verify with `wrong-issuer`.                                                                                                                                                                                                                            |
| `DATABASE_URL`          | yes    | yes            | `crossy_api` role, pooled connection (see Migrations + roles).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SESSION_WS_BASE`       | no     | no             | `wss://<session public domain>`. Builds the game-view `session.ws`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `CORS_ORIGIN`           | no     | no             | `https://<web public domain>`. The SPA is a separate origin (DESIGN.md section 7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `INVITE_HOST`           | no     | no             | `crossy.ing`. The short share-link host (PROTOCOL.md section 12 "Invite links"), an owner-held domain pointed at THIS api service. When set (with a web origin), a request on that host is served the invite surface and nothing else: the `/*` AASA and `GET /{code}` (a 302 into the game for a browser, an OpenGraph shell for an unfurler). Unset, the invite host is off and the api host is unaffected.                                                                                                                                                                                                                    |
| `WEB_ORIGIN`            | no     | no             | `https://crossy.party`. Where the invite host 302s a browser (`{WEB_ORIGIN}/game/{id}?code=...`). Defaults to `CORS_ORIGIN` (the SPA origin and the web origin coincide), so set it only to override that default.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SESSION_INTERNAL_BASE` | no     | no             | `http://session.railway.internal:8082`. Private membership signal target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `INTERNAL_BEARER_TOKEN` | yes    | no             | Strong random, generated by provisioning; identical on session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `APPLE_APP_ID`          | no     | no             | `<TeamID>.<bundleID>` of the iOS app (`MTF6T25BP8.com.eamonma.Crossy`), published in the api's dynamic `/.well-known/apple-app-site-association` and, when `INVITE_HOST` is set, the invite host's AASA (claiming `/*`), so `crossy.ing/{code}` opens the app as a universal link. NOTE: crossy.party's universal links come from the web app's committed static AASA (`apps/web/public`), independent of this var; `APPLE_APP_ID` gates only the API-served AASAs (the api host and the invite host), which serve 404 while it is unset. The App ID is public (already in the web AASA), so set it here to light up crossy.ing. |
| `POSTHOG_TOKEN`         | yes    | no             | PostHog project API key for product analytics (`room_created`). Unset selects a noop; posthog-node is never constructed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POSTHOG_HOST`          | no     | no             | PostHog ingestion host; unset defaults to `https://us.i.posthog.com`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### session

| Variable                | Secret | Supabase-gated | Value / meaning                                                                                                                                              |
| ----------------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                  | no     | no             | `8081`. Public WS + health; the session domain targets it.                                                                                                   |
| `INTERNAL_PORT`         | no     | no             | `8082`. Private `/internal` listener; no public domain.                                                                                                      |
| `HOST`                  | no     | no             | `0.0.0.0`. Bind all interfaces for the private network.                                                                                                      |
| `SUPABASE_ISSUER`       | no     | yes            | Same issuer as api.                                                                                                                                          |
| `DATABASE_URL`          | yes    | yes            | `crossy_session` role, pooled connection.                                                                                                                    |
| `INTERNAL_BEARER_TOKEN` | yes    | no             | Same value as api. Constant-time checked; fails closed (503) if unset.                                                                                       |
| `POSTHOG_TOKEN`         | yes    | no             | PostHog project API key for product analytics (`room_joined`, `solve_completed`, `room_abandoned`). Unset selects a noop; posthog-node is never constructed. |
| `POSTHOG_HOST`          | no     | no             | PostHog ingestion host; unset defaults to `https://us.i.posthog.com`.                                                                                        |

### web

| Variable                   | Secret | Supabase-gated | Value / meaning                                                                                     |
| -------------------------- | ------ | -------------- | --------------------------------------------------------------------------------------------------- |
| `PORT`                     | no     | no             | `8080`. nginx listen port; the web domain targets it.                                               |
| `SUPABASE_URL`             | no     | yes            | `https://api.crossy.party` (the Supabase custom domain). Empty selects the mock identity adapter.   |
| `SUPABASE_PUBLISHABLE_KEY` | no     | yes            | `sb_publishable_...`. Public by design (INV-6). Empty selects the mock identity adapter.            |
| `API_BASE`                 | no     | no             | `https://<api public domain>`. The default REST base; `?api=` still overrides it per link.          |
| `GUESTS_ENABLED`           | no     | no             | `true` or `false` (emitted unquoted into config.json). Ships `false` until anonymous+captcha is on. |
| `TURNSTILE_SITE_KEY`       | no     | no             | Cloudflare Turnstile site key for guest captcha, or empty. Public; wired dark until guests land.    |

The web client takes NO build-time configuration: one immutable image serves every
environment. Runtime config arrives at container start as `/config.json`, emitted from the
env vars above by the nginx envsubst entrypoint (the same mechanism that fills `${PORT}`;
see `apps/web/nginx/default.conf.template`). Its shape is
`{ supabaseUrl, supabasePublishableKey, apiBase, guestsEnabled, turnstileSiteKey? }`. The
client resolves auth through the Identity port built from that config (Supabase Discord OAuth,
plus anonymous guests behind `GUESTS_ENABLED`); the api base defaults to `API_BASE`.

`?api=` and `?token=` remain explicit URL overrides so the e2e smoke and dogfood links keep
working without any account. For dogfooding, share a link of the form
`https://<web domain>/?api=https://<api domain>&game=<id>&token=<jwt>`; without the overrides
a visitor to `https://<web domain>/?game=<id>` signs in with Discord and plays with their own
token.

### CI / GitHub (not Railway service variables)

`MIGRATION_DATABASE_URL` is the privileged Postgres DSN stored in GitHub Actions secrets.
It uses the session pooler (port 5432), never the transaction pooler. The Deploy workflow
requires it on every push to main. `RAILWAY_TOKEN` is obsolete and can be removed once the
source deployment transition is verified.

## Railway source configuration

For each production service (`api`, `session`, `web`):

1. Connect the private `eamonma/crossy` repository and branch `main`.
2. Keep the build context at the repository root. Set Dockerfile path to
   `apps/api/Dockerfile`, `apps/session/Dockerfile`, or `apps/web/Dockerfile` respectively.
3. Enable **Wait for CI** on the GitHub deployment trigger. Verify this after reconnecting
   the source; losing it permits code to deploy before migrations.
4. Use `/health` for API/session health checks and `/` for web.
5. Set watch patterns for that service's app directory, `packages/**`, `vectors/**`,
   `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `package.json`, `.node-version`, `deploy/**`,
   `.github/workflows/deploy.yml`, and `.dockerignore`. Documentation-only changes do not
   restart the session service. Add new shared build inputs to all three services.
6. Remove obsolete registry credentials. No GHCR token is required.

The historical `provision.sh` creates GHCR image sources and is not the bootstrap for this
configuration. Do not run it to recreate the current deployment.

A source connection can be pinned to a commit for controlled recovery. Reconnect it without
a commit pin to resume main autodeploys, then verify **Wait for CI** again. Manual redeploys
for credential rotation must reuse a previously verified build. A manual workflow dispatch
applies migrations only; use Railway's Deploy Latest Commit for a manual code rollout after
confirming the selected commit's checks passed.

## Migrations + roles on hosted Postgres

The committed migration (`packages/db/drizzle/0001_real_schema.sql`) creates the seven
tables, the deny-all RLS tripwire, and the two NOLOGIN service roles `crossy_api` /
`crossy_session` with least-privilege grants (INV-7). The services connect AS those roles,
so each holds only the grants on the tables it owns.

Apply migrations with the shared applier (the same code CI, the Testcontainers test, and the
dev-stack use), as the privileged `postgres` role. From an IPv6-capable machine the DIRECT
connection works; from an IPv4-only environment (GitHub Actions runners) it does not (the
direct host has no A record), so use the SESSION pooler DSN there, which holds one real
backend per session and behaves like direct:

```
MIGRATION_DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
  pnpm exec tsx deploy/migrate.ts
```

### Migration flow in the pipeline

Owner decision 2026-07-09: expand-only migrations ride the pipeline. Every migration in this
repo is expand-only by hard rule (CLAUDE.md), CI already proves each one against a fresh
Postgres (`packages/db` Testcontainers tests), and the Drizzle journal makes the applier
idempotent, so there is nothing to gain from a manual gate for the additive case. The
deliberateness that DESIGN.md section 9 calls for now lives in PR review plus the guard below,
not in a hand-run job.

On every push to `main` and manual workflow dispatch, the `migrate` job runs:

1. `deploy/migration-guard.mjs` (plain node, no install) scans every committed migration
   against a conservative deny-list (DROP, RENAME, TRUNCATE, ALTER COLUMN ... TYPE,
   DELETE FROM, UPDATE, SET NOT NULL, REVOKE). It strips comments and string literals first, so
   a comment mentioning `DROP` does not trip it, and it scans DO-block bodies, so a destructive
   statement cannot hide there. It also requires the Drizzle journal's `when` timestamps to be
   strictly increasing by idx (`scanJournalOrder`): Drizzle applies a migration only when its
   `when` exceeds the highest `created_at` already recorded, so a poisoned (round or future)
   stamp makes an existing database silently skip later migrations while a fresh one applies
   everything. That skipped 0009/0010 in production only, with CI green (#181). If anything
   trips, the deploy FAILS and points here. The #181 follow-up, switching the shared applier
   to hash-based apply so timestamps stop deciding anything, is still open.
2. `deploy/migrate.ts` applies the migrations over `MIGRATION_DATABASE_URL` (the session
   pooler: the runner cannot reach the IPv6-only direct host).

Because Railway waits for the migration workflow to succeed, expand-before-code holds: by the time the new image serves traffic its columns exist, and the old code
meanwhile ignores the additive columns (expand/contract, DESIGN.md section 9). If
`MIGRATION_DATABASE_URL` is absent the job FAILS rather than skipping: a skipped migration with
pending schema is exactly the outage this closes.

The held-PR / apply-from-a-laptop dance is retired for expand-only migrations. You no longer
hold a PR to hand-apply its migration first; merge it and the pipeline applies the expand ahead
of the roll.

#### Destructive or contract-phase migrations (the manual escape hatch)

A contract-phase change (drop a column after readers migrated, a type change, a backfill) is
deliberate and must not ride an auto deploy. Apply it by hand:

> GitHub > Actions > Deploy > Run workflow, pick your branch, check `migrations_only`, and type
> `migrations-only` into `confirm`.

That run applies migrations from the SELECTED ref and builds and rolls NOTHING (rolling
non-`main` code would violate main-is-golden), and it bypasses the guard. Because it respects
the ref, it can apply from a branch before the PR merges. Then add the migration's filename to
`ALLOWLIST` in `deploy/migration-guard.mjs` (with the review justification) in the same PR:
the guard scans the whole tree on every later deploy, so a committed destructive file that is
not allowlisted would block all future auto-deploys.

Then bind login credentials to the NOLOGIN roles (idempotent; rotates the password on re-run):

```
export MIGRATION_DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
export CROSSY_API_DB_PASSWORD="$(openssl rand -base64 24)"
export CROSSY_SESSION_DB_PASSWORD="$(openssl rand -base64 24)"
./deploy/bind-service-roles.sh
```

Set each service `DATABASE_URL` to its role over the POOLED connection:

```
api     : postgresql://crossy_api:<api_pw>@<pooler-host>:5432/postgres
session : postgresql://crossy_session:<session_pw>@<pooler-host>:5432/postgres
```

`migrate.ts` and `bind-service-roles.sh` must never run over the TRANSACTION pooler (port
6543: advisory locks + DDL break there). The DIRECT connection and the SESSION pooler (port
5432 on the pooler host) both work; from an IPv4-only environment only the session pooler
does. The services use the pooler.

Supabase caveat to confirm at apply time: the migration runs `ALTER ROLE crossy_api
BYPASSRLS` (and the same for `crossy_session`). The service roles must bypass the deny-all
RLS tripwire, since they own their tables but are not the table owner role. On hosted
Supabase the managed `postgres` role must be able to grant BYPASSRLS for this to apply. If it
cannot, that is a `packages/db` follow-up owned by the DB workstream (an expand migration),
not a deploy change. This deploy does not modify `packages/db`. Verified locally: the
migration and `bind-service-roles.sql` apply cleanly on stock Postgres 16, and both roles
come back `rolcanlogin = t`, `rolbypassrls = t`.

## Invite host and rate limiting (crossy.ing)

`crossy.ing` is the short share-link host (PROTOCOL.md section 12 "Invite links"). It is an
owner-held domain that must front the **api** service, not web: the invite logic lives in the API,
and the host serves `GET /{code}` (a 302 into the game for a browser, an OpenGraph shell for an
unfurler) plus its own `/*` AASA. Owner actions, in order:

1. Cloudflare: `crossy.ing` DNS, proxied (orange-cloud), to the api service's Railway target.
2. Railway: add `crossy.ing` as a custom domain on `api` (target port 8080). Set `INVITE_HOST=crossy.ing`.
   `WEB_ORIGIN` is optional (it defaults to `CORS_ORIGIN`, which is already the web origin). Set
   `APPLE_APP_ID` (public value `MTF6T25BP8.com.eamonma.Crossy`) so the invite host's AASA publishes
   and `crossy.ing/{code}` opens the iOS app as a universal link once a build carrying
   `applinks:crossy.ing` ships (Automatic signing updates the App ID capability on that build).
3. Cloudflare Rate Limiting Rules, the PRIMARY limiter: per-IP caps on `crossy.ing/*`, and on
   `rest.crossy.party` `POST /games/join`, `/games/*/join`, and `/g/*`. These records must be proxied
   for the rules to apply.

The api also rate-limits these code paths in process as defense in depth: 30/min per user on the two
join endpoints, 60/min per IP on the public `GET /{code}` and `/g/{code}`, returning 429 with
`Retry-After` (`RATE_LIMITED`). This is a backstop and a stopgap before the edge rules exist; the
invite host's AASA path is never limited (Apple's CDN fetches and may retry it).

## Custom domain cutover: crossy.me to crossy.party

The product domain moves from `crossy.me` to `crossy.party`. The code is already renamed
(the plist, entitlement, privacy/terms pages, and tests all read `crossy.party`); what
remains is env, DNS, and dashboards. Target mapping:

| Domain                 | Fronts               | Replaces (crossy.me) |
| ---------------------- | -------------------- | -------------------- |
| `crossy.party`         | web (Railway)        | `crossy.me`          |
| `session.crossy.party` | session (Railway)    | `session.crossy.me`  |
| `rest.crossy.party`    | api (Railway)        | `rest.crossy.me`     |
| `api.crossy.party`     | Supabase auth (cust) | `api.crossy.me`      |

The Railway images carry no domains, so the web/session/api hostname moves are env + DNS
only. The web image does bake the static pages (`privacy.html`, `terms.html`, the AASA,
`og.png`), so those refresh when the rename PR merges and the pipeline rebuilds web. Owner
actions, in order:

1. **Supabase custom domain.** A project has ONE custom domain, so you re-point it, not add
   a second. Dashboard > Custom Domains: set `api.crossy.party`, add the CNAME + TXT it
   generates, activate. Supabase reissues the cert; `api.crossy.me` stops fronting the API
   at cutover. Requires the Custom Domain add-on.
   - Do NOT touch `SUPABASE_ISSUER`. The `iss` claim stays on the ref domain
     (`https://<ref>.supabase.co/auth/v1`) regardless of the custom domain; the custom
     domain only fronts the API. Setting the issuer to the custom domain breaks every
     verify with `wrong-issuer` (see the api env table). This is why auth survives the swap.
2. **Supabase Auth > URL Configuration:** Site URL `https://crossy.party`; add
   `https://crossy.party/**` to the redirect list. Keep old entries until nothing links there.
3. **OAuth providers.** Discord app OAuth2 redirects and the Apple Sign in with Apple
   Service ID return URLs must cover the callback host Supabase uses
   (`https://api.crossy.party/auth/v1/callback`). Native iOS Apple sign-in uses the bundle
   id, not a web return URL, so only the web redirect path needs this.
4. **DNS at the registrar.** `rest.` and `session.` are plain CNAMEs to their Railway
   targets. The apex `crossy.party` needs ALIAS/ANAME (or CNAME flattening) to the web
   target. `api.crossy.party` uses the CNAME + TXT from step 1. Add MX/forwarding so
   `privacy@crossy.party` and `legal@crossy.party` receive mail. Wait for every cert issued.
5. **Railway custom domains.** Per service, Settings > Networking > Custom Domain, on the
   public port (web 8080, session 8081, api 8080). Keep the `up.railway.app` domains during
   the transition; old links do not break.
6. **Railway env** (redeploys on change, no rebuild; web values feed `/config.json` at start):
   - api: `CORS_ORIGIN=https://crossy.party`, `SESSION_WS_BASE=wss://session.crossy.party`,
     `SUPABASE_URL=https://api.crossy.party`
   - web: `SUPABASE_URL=https://api.crossy.party`, `API_BASE=https://rest.crossy.party`
   - session: unchanged (only `SUPABASE_ISSUER`, which stays on the ref domain)
7. **iOS build.** Cut a fresh signed build after the rename merges: only a new build carries
   `applinks:crossy.party` and the party URLs. Universal Links resolve once crossy.party
   serves the AASA (content is appID-only, unchanged) and the new build is installed. Old
   `crossy.me` invite links stop deep-linking on the new build (`applinks:crossy.me` is gone).
8. **App Store Connect metadata:** privacy policy URL `https://crossy.party/privacy`;
   support/marketing URLs if they point at crossy.me.
9. **Verify:**
   `node deploy/verify.mjs --api https://rest.crossy.party --web https://crossy.party --session wss://session.crossy.party`,
   `curl https://crossy.party/.well-known/apple-app-site-association` (appID + `application/json`),
   then sign in end to end with both Discord and Apple.

## What happens on a push to main

1. A reviewed PR merges to main. GitHub runs CI and the Deploy migration workflow.
2. Railway queues deployments only for services whose watch patterns match the changes.
3. Wait for CI holds those deployments until all GitHub Actions workflows finish. A failed
   migration workflow blocks deployment; migration runs must never be cancelled.
4. Railway builds each selected service with its committed Dockerfile and deploys it behind
   its existing domains. Health checks must pass before the replacement serves traffic.
5. Run `deploy/verify.mjs` to confirm HTTPS, WebSocket negotiation, and private-port isolation.

## Post-deploy verification

`deploy/verify.mjs` (Node built-ins only, no install) checks: api `/health` over HTTPS, web
over HTTPS, a WS handshake reaching the session with `permessage-deflate` negotiated, and
that `/internal` is NOT reachable on the session public domain (expects 404 or timeout). It
sends no WebSocket frame, so no board or solution ever crosses the wire (INV-6). The
api-to-session private path (`session.railway.internal:8082/internal`) can only be exercised
from inside Railway. To probe it directly: register an SSH key (`railway ssh keys github`),
link the repo (`railway link -p crossy -e production`), open a shell in the api service
(`railway ssh -s api`), and POST to
`http://session.railway.internal:8082/internal/games/<uuid>/membership-changed` with node
fetch. Expect `401`: served, private, bearer required (fail-closed). Quoting does not
survive `railway ssh -- <cmd>`, so run it from the interactive shell.

## Supabase auth session policy (config-as-code)

The auth (GoTrue) session policy decides how long a signed-in web session lasts. It lived
only in the Supabase dashboard, unversioned. `deploy/supabase-auth.toml` records the audited
values so a change to session lifetime is a reviewable diff (CLAUDE.md: server config lives in
the repo; a dashboard-only setting is a defect). The file is a RECORD, not an applier: nothing
in the pipeline reads or pushes it, and this project is not managed by the Supabase CLI. Editing
it does not change the server.

### Audited values

Read read-only on 2026-07-13 from the Management API,
`GET https://api.supabase.com/v1/projects/qvnvokstvbarsxhufrja/config/auth` (project `Crossy`,
`us-east-1`; org plan `pro`).

| Setting                      | Management API field                    | Value | Meaning                                        |
| ---------------------------- | --------------------------------------- | ----- | ---------------------------------------------- |
| Access token (JWT) expiry    | `jwt_exp`                               | 3600  | 1 hour access-token lifetime                   |
| Refresh token rotation       | `refresh_token_rotation_enabled`        | true  | rotate on every refresh; reuse-detection armed |
| Refresh token reuse interval | `security_refresh_token_reuse_interval` | 10    | 10s grace window to replay the prior token     |
| Session time-box             | `sessions_timebox`                      | 0     | disabled (no forced max session length)        |
| Inactivity timeout           | `sessions_inactivity_timeout`           | 0     | disabled (no logout on inactivity)             |
| Single session per user      | `sessions_single_per_user`              | false | a new sign-in does not evict other sessions    |

The dashboard toggle "Detect and revoke potentially compromised refresh tokens" is the rotation
feature above: with `refresh_token_rotation_enabled = true`, a rotated-out refresh token presented
after the reuse window revokes the whole session's token family.

### Assessment against the "signed out on access-token cadence" symptom

The one value that matches the symptom cadence is `jwt_exp = 3600`, and it governs the ACCESS
token, not the session. A backgrounded tab whose refresh ticker paused lets the access token go
stale after an hour, but the refresh token is still valid and mints a new session on foreground.
That is a recoverable client state, not a server logout, and it is what the parallel client tracks
fix.

Nothing in this policy force-terminates a good session on a schedule: time-box, inactivity timeout,
and single-session-per-user are all off. So the server is not the cause of a periodic hard logout.

The only server path to a true hard logout (refresh token rejected) is rotation plus reuse
detection: if two contexts share one refresh token (multi-tab, or a race between a
visibility-change refresh and a scheduled one) and the loser presents its now-rotated-out token
more than 10s later, reuse detection revokes the whole family and every tab drops. A paused
background ticker makes the late replay more likely. Nothing here is pathological: 10s is the
Supabase default, not an aggressive reuse interval, and no sessions are time-boxed. The fix for
that race belongs in the client refresher (serialize refreshes, one source of truth for the token
across tabs), not in loosening reuse detection on the server.

### Recommended values for "sessions last until deliberate sign-out"

The current server config already meets this target and needs no change:

- Refresh token rotation: keep ON. Rotation with reuse detection is the security floor; disabling
  it would make refresh tokens never expire.
- Reuse interval: keep 10s (the default). It is a reasonable grace window. Do not shorten it. Only
  consider raising it (e.g. to 20-30s) if the client keeps tripping reuse revocation after the
  client-side refresher is serialized, and only as a diagnostic, never below the default.
- Time-box (`sessions_timebox`): keep 0 (disabled). Any nonzero value forces a hard logout at that
  interval regardless of activity, which is the opposite of the target.
- Inactivity timeout (`sessions_inactivity_timeout`): keep 0 (disabled).
- Single session per user: keep false, so a second tab or device does not evict the first.
- JWT expiry: 3600 is fine and orthogonal to session length. A shorter value increases refresh
  frequency (and reuse-race exposure); a longer value widens the window a revoked-but-unexpired
  access token stays usable. Leave at 3600 unless a separate requirement moves it.

### Change process (what the repo rules imply)

This track is read, record, recommend: no server setting was mutated. To change a value later:
land the edit to `deploy/supabase-auth.toml` in a reviewed PR (main is golden: PR + green checks,
squash merge, no direct push), then the owner applies the identical value out of band via the
Management API `PATCH /v1/projects/<ref>/config/auth` (or the dashboard, Authentication >
Sessions). There is no pipeline step that applies auth config today; the file and the server are
kept in sync by that PR-then-owner-apply discipline, the same shape as the rest of `deploy/`.

## Files

- `provision.sh`: historical GHCR bootstrap; not for the current source deployment setup.
- `supabase-auth.toml`: audited record of the Supabase auth session policy (config-as-code; a
  record, not an applier; see "Supabase auth session policy" above).
- `migration-guard.mjs`: plain-node guard run before `migrate.ts` in the pipeline
  (`node deploy/migration-guard.mjs`): the expand-only deny-list plus the strictly monotonic
  journal check (#181). Its pure functions are unit-tested in
  `packages/db/src/migration-guard.test.ts` (with the `migration-guard.d.mts` type companion).
- `migrate.ts`: apply `packages/db` migrations to hosted Postgres (privileged DSN: direct
  or session pooler, never the transaction pooler).
- `bind-service-roles.sql` / `bind-service-roles.sh`: grant LOGIN to the NOLOGIN service roles.
- `verify.mjs`: post-deploy HTTPS + WS + private-endpoint checks.
