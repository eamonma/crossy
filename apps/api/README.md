# @crossy/api

The core API (DESIGN.md section 7): a stateless modular monolith over REST. Modules:
identity and membership, puzzle catalog, games, archive. This package holds the Wave 2.1b
walking-skeleton slice.

## Endpoints in this slice

- `POST /puzzles`: full account. Ingest XWord Info JSON through the anti-corruption layer
  (`puzzles/ingest.ts`): translate it into the internal `ServerPuzzle`, apply the named
  rejections, store the model plus detected features server-side, return the `ClientPuzzle`
  view. A malformed body is `VALIDATION` (400); a well-formed but unacceptable puzzle is one
  named rejection (422). See "Puzzle ingestion" below.
- `POST /games`: full account. Create a game from a puzzle, mint an invite code, seat the
  creator as `host`.
- `POST /games/{id}/join`: any authenticated user, guests included. Join by invite code,
  seated as `spectator`; idempotent and non-demoting.
- `GET /games/{id}`: member only. The game view: solution-stripped puzzle (`ClientPuzzle`),
  membership, and the session WebSocket endpoint.
- `POST /games/{id}/role`: member only. Self-upgrade `spectator` to `solver`; one action,
  idempotent. Signals the session so a live spectator socket becomes a solver at once.
- `DELETE /games/{id}/members/{userId}`: host only. Kick: remove the membership row and write
  the denylist in one transaction, then signal the session to disconnect any live socket. The
  host MUST NOT target themselves (`FORBIDDEN`). The API is the single writer on memberships
  and the denylist (INV-7).
- `POST /games/{id}/abandon`: host only. Authorize the host and dispatch to the session, which
  emits and synchronously flushes `gameAbandoned` (the actor executes; abandon on a terminal
  game is a no-op, INV-4).
- `DELETE /account`: any authenticated user. Delete the caller's own account: tombstone the
  mirror row (scrub PII, keep the id), remove membership and denylist rows, run host succession
  (DESIGN.md section 7), and remove the vendor identity behind an injected port. PROTOCOL.md
  section 12 lists no account-deletion route; this is flagged for the docs ledger.

- `GET /.well-known/apple-app-site-association`: public, no auth, no redirect (Apple's CDN
  follows none). The AASA file that lets `/g/{code}` invite links open the iOS app as
  universal links (apps/ios/ROADMAP.md SP-i4); it lives on the API because the API is the
  normative home of `GET /g/{code}` (PROTOCOL.md section 12). Serves the modern components
  format scoped to `/g/*` only, appID from `APPLE_APP_ID` (`<TeamID>.<bundleID>`); when that
  is unset the route is 404, fail closed, since the Apple app record is owner-held and does
  not exist yet. `webcredentials` (passkeys) is a post-v1 addition to the same file.

Every route except the well-known file is bearer-authenticated through the `AuthPort`; the
first authenticated request mirrors the identity into `users` (JIT upsert, the API being the
single writer on `users`).

## Membership lifecycle (M3a) and the internal signal

Kick, role upgrade, abandon, and account deletion (host succession) are the M3a slice. The API
owns every write to `memberships` and `game_denylist` (INV-7); the session service only
verifies (INV-8). When a change is committed the API signals the session at
`POST /internal/games/{id}/membership-changed` with a static bearer, so a live actor
re-verifies and disconnects anyone no longer allowed, or executes an abandon. Two env vars wire
this notifier in the composition root, both optional so the local dev stack runs without them:

- **`INTERNAL_BEARER_TOKEN`**: the static internal bearer, shared with the session service
  (which verifies it). Injected via config, never hardcoded.
- **`SESSION_INTERNAL_BASE`**: the session service base URL on the provider's private network
  (for example `http://session.railway.internal:8081`).

When either is unset the notifier is a no-op: the membership and denylist writes stay
authoritative, so a kicked user is still refused at reconnect via the denylist, and the live
disconnect plus abandon land at M3b deploy time. An abandon requires the notifier (only the
actor can write `game_state`), so an abandon with the notifier unconfigured or unreachable
returns `INTERNAL` (500).

Two REST codes not in the PROTOCOL.md section 12 table were added and flagged for the docs
ledger (`http/errors.ts`): `FORBIDDEN` (403, a member who is not permitted the action, or a
host self-kick) and `INTERNAL` (500, reusing the section 11 name for a downstream fault).

Vendor account deletion lives in the API identity module behind an injected `VendorIdentityPort`
(the boundary decision is recorded in `packages/auth`): it is a rare admin mutation paired with
the API-owned tombstone write, not the per-request verification the auth port exists for. The
real Supabase admin adapter is M3b; M3a ships the port and a test fake, so no test touches the
network. `cell_events.user_id` stays `ON DELETE NO ACTION` and is never touched by deletion, so
the event log stays contiguous through a tombstone (DESIGN.md section 9).

## HTTP framework: Hono (decision for review)

DESIGN.md section 7 does not name an HTTP framework, so this slice picks the smallest thing
that works and flags it. Hono is a good fit for three reasons. Its core has zero runtime
dependencies, which keeps the fresh-clone install small and the boundary surface honest. It
is built on the standard Fetch `Request`/`Response`, so a handler is a pure function of a
request and tests drive it in-process with `app.request(...)` and never open a socket, which
is exactly the zero-network-in-tests rule this repo enforces. And `buildApp(deps)` takes its
ports as arguments, so the same app runs against the in-memory auth fake in tests and the
Supabase adapter in production with no branching. Alternatives considered: raw `node:http`
(no dependency, but hand-rolled routing and no clean in-process test entry) and Express
(heavier, callback-shaped, and its testing story wants a live server or `supertest`). Revisit
if the API grows needs Hono does not cover.

## Invite codes

DESIGN.md section 7 specifies the format exactly: `/g/{code}`, 8 characters from the
unambiguous alphabet `[2-9A-HJ-NP-Z]`, crypto-random. The generator (`games/invite-code.ts`)
implements that verbatim; the `games.invite_code` CHECK constraint pins the same regex as
defense in depth. Codes use `randomInt` from `node:crypto` (bias-free, since 32 divides the
generator range), and creation retries on the rare unique-constraint collision.

## Puzzle ingestion (the anti-corruption layer, G1)

`puzzles/ingest.ts` translates one XWord Info JSON document into the internal `ServerPuzzle`
exactly once, at the boundary (DESIGN.md section 7). Nothing downstream parses the external
format. The module is pure (no IO, no DB), so its full rejection matrix is a fast unit suite
(`ingest.test.ts`); the endpoint wiring and the INV-6 no-leak backstop on every rejection path
are integration tests in `api.test.ts`, driven as the `crossy_api` role.

`translateXwordInfo` is deterministic and total: one document in, either an accepted normalized
puzzle or exactly one named rejection with a stable code. The check order is fixed and
documented on the function so the same bad puzzle always yields the same code:

1. `VALIDATION` (400): body is not a well-formed XWord Info document (object, `size` with
   positive integer `rows`/`cols`, `grid` of `rows*cols` strings, `clues.across`/`clues.down`
   string arrays, `circles` shape when present).
2. `DIAGRAMLESS` (422): the document declares a diagramless puzzle (known-incompatible flag).
3. `OVERSIZE_GRID` (422): `rows` or `cols` over 25, checked per dimension (SP5: grids are not
   always square or odd). Placed early because it is the cheapest global bound.
4. `DEGENERATE_GRID` (422): zero playable cells (completion would be vacuous).
5. `REBUS_TOO_LONG` (422): a normalized solution over the 10-character cap (SP5).
6. `UNSOLVABLE_CELL` (422): a solution cell with no `A-Z0-9` first character after ASCII
   uppercasing (INV-1), so no legal input completes it. `A/B` is fine (typing `A` completes
   it under first-char acceptance, D12); a whole-symbol cell like `/` is not.
7. `AMBIGUOUS_SOLUTION` (422): a direction lists two clues for one slot (SP5 Schroedinger).
8. `VALIDATION` (400): the clue count does not match the grid's word runs; else the puzzle is
   accepted.

Charset normalization reuses the shared `asciiUppercase` (`@crossy/protocol`), so ingestion and
the reducer fold identically (INV-1); a locale-aware upcase is forbidden. Clue numbering is
derived from the grid, never trusted from the file (SP5: real puzzles carry odd numberings).
Asymmetric grids and unchecked cells are accepted on purpose (SP5). Rejection messages carry a
code and a generic reason, never solution text (INV-6).

Two facts recorded for the docs amendment ledger: the 400-vs-422 status split is proposed here
(PROTOCOL.md section 12 lists the rejections but not their statuses); and URL-based ingest
("body or URL", PROTOCOL.md section 12; DESIGN.md section 1) is deferred, because no source
specifies its request contract (the URL field, allowed schemes, SSRF posture). It is left out
rather than invented; when the contract lands it should arrive behind an injected fetcher so
tests stay network-free.

## Testing

`vitest run`. Unit tests (invite-code format) need no infrastructure. The integration suite
boots a Testcontainers Postgres, applies the committed migrations, and drives every endpoint
through `app.request(...)`. It runs the app's database connections under the least-privilege
`crossy_api` Postgres role (assumed at connection startup via the `role` option), so the
grants from the migration are exercised: the API writing its five owned tables succeeds, and
it structurally cannot touch the session-owned `game_state` or `cell_events`. Auth is the
in-memory fake, which mints real ES256 tokens; the Supabase adapter is constructed only in
`server.ts`, never in a test.

## Runtime

`server.ts` is the composition root: it reads `DATABASE_URL`, `SUPABASE_ISSUER`, and
`SESSION_WS_BASE` (required), plus the optional `CORS_ORIGIN`, `SESSION_INTERNAL_BASE`,
`INTERNAL_BEARER_TOKEN`, and `APPLE_APP_ID` (the iOS `<TeamID>.<bundleID>` for the AASA
route; owner-set in Railway once the Apple app record exists, see `deploy/README.md`).
It constructs the live ports and listens. Deployment provisions a login role carrying
`crossy_api`'s privileges (see the migration note), so no `SET ROLE` is needed in
production.
