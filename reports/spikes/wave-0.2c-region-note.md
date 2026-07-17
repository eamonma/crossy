---
status: archive
---

# Wave 0.2c: Supabase region recommendation and create-project checklist

Question (DESIGN.md §15, ROADMAP 0.2c): which region hosts the Postgres project, given
the owner is in the Eastern timezone (likely Toronto) and the session service runs on
Railway (D17)? The owner creates the project; this note closes the research half so the
create step is mechanical.

## Recommendation

**East US (North Virginia), AWS `us-east-1`.**

## Why

The latency that matters is session-service-to-database, not owner-to-database.
Keystrokes never touch Postgres: the actor serves from memory and writes behind (D01,
§6). Postgres is on the hydrate path (first connect), the write-behind flush (~25
events / ~5 s), and the synchronous terminal flush. So the co-location target is
DB next to the session service (D17: "co-locate regions"), and the owner's WebSocket
terminates at the session service, not at the DB.

Railway decides where the session service sits. Railway has four core compute regions
(US West / California, US East / Virginia, EU West / Amsterdam, Southeast Asia /
Singapore) and **no Canadian region**. The closest to a Toronto owner is US East
(Virginia). That pins the session service to Virginia, so the DB should be in Virginia
too: Supabase `us-east-1` keeps DB and session in one metro (sub-5 ms), which is what
the flush and hydrate paths want.

`ca-central-1` (Canada Central, Montreal) is physically closer to a Toronto owner
(~8-12 ms vs ~15-20 ms to Virginia) and is tempting on that basis. It is the wrong
choice here: it would split the two tiers that co-location exists to keep together,
putting the DB in Montreal and the session service in Virginia, adding a cross-region
hop on the exact DB-to-session path co-location protects, for no gain (the owner's
socket ends at the Virginia session service regardless). Owner-to-Virginia RTT of
~15 ms is imperceptible for a collaborative crossword.

Supabase Auth is not a region factor: JWTs verify locally against published keys
(D05, SP2), no per-request call to a regional auth endpoint.

### If Railway is later swapped for Fly.io (D17 alternate)

Fly has a Toronto region (`yyz`). If the session service moves to Fly, revisit toward
`ca-central-1` + Fly `yyz`/`yul` so both tiers sit in Canada and shave the owner-path
latency. D17 keeps this a config change: Docker images plus `DATABASE_URL`. Region is
not a one-way door, but moving a live Supabase project's region is a migration, so
choose against the current hosting decision (Railway), not a hypothetical one.

## Create-project checklist (owner action)

1. **Create the Supabase project.** Region: **East US (North Virginia) / `us-east-1`**.
   Set a strong database password and store it in the password manager.
2. **Capture two connection strings.** The **direct** connection (`db.<ref>.supabase.co:5432`,
   session mode) is for migrations: the Drizzle migrator takes an advisory lock and runs
   DDL, so it must not go through the transaction pooler on `:6543`. The **pooler** URI is
   for app runtime. Store the direct URL as the secret the migration step uses.
3. **Capture auth material for the port (SP2).** Project ref and the JWKS / issuer URL
   (`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`). No anon or service-role
   key is used at runtime beyond Auth (D05).
4. **Enable anonymous sign-in** in Auth settings (guests, D09 / SP1). Apple and Discord
   providers are M3 scope: defer.
5. **Provision Railway.** One project, two services (api, session), region **US East
   (Virginia)**. Set `DATABASE_URL` (pooler for the apps, direct for the migration step).
   Confirm `/internal` private-network reachability at M1 (SP3).
6. **Apply migrations on deploy.** Point `packages/db`'s `applyMigrations(directUrl)`
   (or `drizzle-kit migrate`) at the direct connection. The Testcontainers test in
   `packages/db/src/migrate.test.ts` already proves the committed migrations apply from
   empty.
7. **Least-privilege roles** (api, session) per DESIGN §7 / §9 land with the real seven
   tables in Wave 1.1f; the scaffold marker needs none.
8. **Record the decision.** After creating the project, tick ROADMAP 0.2c's remaining
   owner action and update DESIGN §15's region line from "choose at M0" to `us-east-1`.

## Remaining owner actions (only these; everything else in 0.2c is done)

- Create the Supabase project in `us-east-1` (steps 1-4 above).
- Create the Railway project in US East / Virginia and wire `DATABASE_URL` (step 5).
- Tick ROADMAP 0.2c and close DESIGN §15's region line (step 8).

## Sources

- Supabase regions (confirms `us-east-1` and `ca-central-1`):
  https://supabase.com/docs/guides/platform/regions
- Railway regions (US East = Virginia; no Canadian region):
  https://docs.railway.com/deployments/regions
