# @crossy/api

The core API (DESIGN.md section 7): a stateless modular monolith over REST. Modules:
identity and membership, puzzle catalog, games, archive. This package holds the Wave 2.1b
walking-skeleton slice.

## Endpoints in this slice

- `POST /puzzles`: full account. Ingest a `ServerPuzzle` fixture (shape validation only),
  store it with solutions server-side, return the `ClientPuzzle` view.
- `POST /games`: full account. Create a game from a puzzle, mint an invite code, seat the
  creator as `host`.
- `POST /games/{id}/join`: any authenticated user, guests included. Join by invite code,
  seated as `spectator`; idempotent and non-demoting.
- `GET /games/{id}`: member only. The game view: solution-stripped puzzle (`ClientPuzzle`),
  membership, and the session WebSocket endpoint.

Every route is bearer-authenticated through the `AuthPort`; the first authenticated request
mirrors the identity into `users` (JIT upsert, the API being the single writer on `users`).

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
`SESSION_WS_BASE`, constructs the live ports, and listens. Deployment provisions a login role
carrying `crossy_api`'s privileges (see the migration note), so no `SET ROLE` is needed in
production.
