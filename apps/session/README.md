---
status: descriptive
verified: 133db08
---

# @crossy/session

The session service (DESIGN.md section 3, section 6): the stateful WebSocket tier. One
in-memory actor per live game is the single writer for its `game_state` and `cell_events`.
Handshake, mailbox, write-behind flush, reconnect resync, and SIGTERM drain landed in Wave
2.1c and 2.2; this file documents the M3a membership lifecycle additions.

## Endpoints

- `wss://{host}/games/{gameId}/ws`: the gameplay socket (PROTOCOL.md section 2). Handshake
  check order is fixed: version, token, game, denylist, then membership, with the denylist
  strictly before membership so a kicked user gets `DENIED`, not `NOT_PARTICIPANT`.
- `GET /` (and any other path): a plain `ok` health probe.
- `POST /internal/games/{gameId}/membership-changed`: the internal membership signal
  (DESIGN.md section 6). See below.
- `POST /internal/games/{gameId}/live-activity-registered`: the Live Activity welcome
  notice (PROTOCOL.md section 12a). The API POSTs here after a token registers, so the
  emitter hands the fresh island the current authoritative frame at once. Same static
  bearer and private-port routing as membership-changed.

## The membership-changed internal endpoint (DESIGN.md section 6, INV-8)

The API is the single writer on memberships and the denylist. After it commits a change it
calls this endpoint so a live actor enforces the new authoritative state. The session
verifies, it never mutates (INV-8):

- The request body is only a hint. Shape:
  `{ "change": "kick" | "role" | "abandon", "userId"?: string, "by"?: string }`. For a kick
  or role change the session re-reads membership and the denylist from Postgres and acts on
  that, so the body cannot assert a membership fact.
- Kick or role change touches only the live actor's connected sockets: a denied user is sent
  `kicked` and closed 1008, and the rest have their cached role refreshed. A passivated game
  has no live actor, so the call is a no-op (the denylist plus connect-time re-verify enforce
  it at the next connect); this path never hydrates.
- Abandon hydrates the actor on demand, since only the actor may write `game_state`, and
  emits and synchronously flushes `gameAbandoned` before broadcast. Abandon on an already
  terminal game is a no-op (INV-4).

### Authentication and the static bearer

The endpoint is bearer-authenticated with a static secret shared with the API. It arrives via
config, never hardcoded:

- **`INTERNAL_BEARER_TOKEN`** (env): the static internal bearer. The endpoint requires
  `Authorization: Bearer $INTERNAL_BEARER_TOKEN`. When the variable is unset the endpoint is
  disabled and returns 503, so a misconfigured deploy fails closed rather than serving the
  endpoint unauthenticated. The comparison is constant-time.

Responses: 200 `{ ok: true }` on success, 401 (no bearer), 403 (wrong bearer), 400 (malformed
body), 503 (endpoint not configured), 500 (internal fault).

The bearer is defense-in-depth on an already-private channel (DESIGN.md section 6, section
15). Its blast radius stays a forced re-verification, disconnect, or abandon, never data
access, because the actor re-reads authoritative state from Postgres and treats the body only
as a hint.

## Live Activity push (`src/push/`)

The session pushes iOS Live Activity updates over APNs as a game progresses (PROTOCOL.md
"Live Activity push"). The emitter (`emitter.ts`) turns actor events into frames, `roster.ts`
tracks the registered per-activity update tokens for a game, `policy.ts` decides when a frame
is worth a push (rate and change gating), `tokens.ts` reads the tokens the API registered, and
`apns.ts` is the APNs adapter over HTTP/2. It is built only when the APNs env is complete;
otherwise the emitter is inert and the rest of the service runs unchanged, so dev and CI never
touch APNs.

## Configuration

Read only in `main.ts` (12-factor), passed to `createSessionServer`:

| Variable                                            | Required | Purpose                                                                                                |
| --------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                                      | yes      | Postgres connection (the `crossy_session` role in production).                                         |
| `SUPABASE_ISSUER`                                   | yes      | Token issuer for the auth port (JWKS derived from it).                                                 |
| `INTERNAL_BEARER_TOKEN`                             | no       | Enables the internal endpoints (membership-changed, live-activity-registered); unset disables them.    |
| `PORT` / `HOST`                                     | no       | Listen address (defaults 8081 / 0.0.0.0).                                                              |
| `INTERNAL_PORT`                                     | no       | Separate private port for `/internal` (Railway deploy); unset serves `/internal` on the public `PORT`. |
| `APNS_TEAM_ID` / `APNS_KEY_ID` / `APNS_PRIVATE_KEY` | no       | APNs credentials for the Live Activity push emitter; with any absent the emitter is inert.             |
| `PASSIVATE_AFTER_MS`                                | no       | Override the idle-passivation window (DESIGN.md section 15); unset uses the server default.            |
| `POSTHOG_TOKEN`                                     | no       | Enables product analytics (posthog-node); unset selects a noop and the SDK is never constructed.       |
| `POSTHOG_HOST`                                      | no       | PostHog ingestion host; defaults to `https://us.i.posthog.com`.                                        |

## Testing

`vitest run`. The integration suite boots a Testcontainers Postgres, applies the committed
migrations, and drives the real server over real `ws` sockets and the real internal endpoint.
The server pool runs as the least-privilege `crossy_session` role, so the grants are exercised
for real: the session can write `game_state` and `cell_events` but is provably denied writes to
`memberships` and `game_denylist` (INV-7, INV-8). Auth is the in-memory fake; no suite touches a
network.
