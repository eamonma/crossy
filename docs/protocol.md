# Crossy Realtime Protocol, version 1

Status: draft 1, for review. Date: 2026-07-07.
Consumers: the session service (TypeScript), the web client (TypeScript), the iOS client (Swift).
Precedence when sources disagree: conformance vectors, then this document, then any implementation.
Key words MUST, SHOULD, MAY follow RFC 2119.

## 1. Principles

- **Server-authoritative.** The session service assigns the order of all board mutations. Clients predict locally, then reconcile to the server's order.
- **Sequenced events vs ephemeral notices.** Anything that changes durable game state carries a per-game sequence number (`seq`). Presence and cursors do not.
- **Per-cell last-write-wins under a total order.** There is no compare-and-swap and no conflict message; the later event stands, attributed to its writer.
- **Full-snapshot resync.** Reconnection always transfers the whole board (< 20 KB at the 25x25 grid cap). There are no deltas.
- **Idempotent commands.** Every mutating command carries a client-generated `commandId`. The server drops duplicates silently, so resending is always safe.

## 2. Transport and handshake

- Endpoint: `wss://{session-host}/games/{gameId}/ws`
- Framing: one JSON object per text frame, UTF-8.
- The first frame from the client MUST be `hello`. Anything else: `error UNAUTHORIZED` (fatal), close `1008`.

`hello` (client to server):

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "token": "<access JWT>",
  "resumeFromSeq": 123
}
```

- `token`: the identity provider's access token. The server verifies it locally against the provider's published keys, resolves the user, and checks membership and the denylist for `gameId`.
- `protocolVersion`: integer. The server supports the current version N and N-1. Anything else: `error PROTOCOL_VERSION_UNSUPPORTED` (fatal, message names the supported range), then close.
- `resumeFromSeq`: optional and informational; the server replies with a full snapshot regardless.

`welcome` (server to client) on success:

```json
{"type":"welcome","protocolVersion":1,"self":{"userId":"...","role":"solver"},"board":{ ... }}
```

The connection is then live: the server pushes events and notices; the client may send commands.

Close codes: `1000` normal, `1008` after any fatal error, `1001` server shutdown (clients reconnect on `1001`).

## 3. Conventions

- `type`: string, camelCase, required on every message.
- `cell`: integer index into the row-major grid, 0-based. `row = floor(cell / cols)`, `col = cell mod cols`.
- Values: strings matching `^[A-Z0-9]{1,10}$` after normalization. Clients SHOULD uppercase before sending; the server normalizes regardless. `null` means empty. Multi-character values are rebus entries.
- `seq`: integer, per game, starting at 1, contiguous, assigned only by the server.
- `commandId`: client-generated UUIDv4, unique per command.
- `at`: ISO 8601 UTC timestamp, server clock only. Clients never supply timestamps.
- Unknown fields MUST be ignored (forward compatibility). Unknown notice types from the server: ignore and log. Unknown command types from a client: `error UNKNOWN_TYPE` (non-fatal).

## 4. The board payload

Used inside `welcome` and `sync`. The puzzle itself (geometry, numbers, circles, clues) comes from REST (section 12) and is immutable per game; the board payload carries only mutable state.

```json
{
  "seq": 412,
  "status": "ongoing",
  "firstFillAt": "2026-07-07T19:02:11Z",
  "completedAt": null,
  "abandonedAt": null,
  "cells": [ {"v":"A","by":"<userId>"}, {"v":null,"by":null}, ... ],
  "participants": [ {"userId":"...","displayName":"Ana","color":"#7F77DD","role":"host","connected":true} ],
  "cursors": [ {"userId":"...","cell":17,"direction":"across"} ],
  "stats": null
}
```

- `cells` has length `rows * cols`. Black squares are present, always `{"v":null,"by":null}`, and immutable.
- `status` is one of `ongoing`, `completed`, `abandoned`. `stats` is non-null only when completed: `{solveTimeSeconds, totalEvents, participantCount}`.
- Solutions are never present in any message on this protocol (DESIGN.md INV-6).

## 5. Client to server messages

| type           | role required     | fields                       | notes                              |
| -------------- | ----------------- | ---------------------------- | ---------------------------------- |
| `hello`        | any authenticated | see section 2                | first frame only                   |
| `placeLetter`  | host, solver      | `commandId`, `cell`, `value` | board mutation                     |
| `clearCell`    | host, solver      | `commandId`, `cell`          | board mutation; value becomes null |
| `moveCursor`   | host, solver      | `cell`, `direction`          | ephemeral; at most 10/s            |
| `checkRequest` | host, solver      | `commandId`                  | whole-grid check                   |
| `heartbeat`    | any               | none                         | every 15 s                         |
| `requestSync`  | any               | none                         | server replies `sync`              |

`direction` is `"across"` or `"down"`.

Validation and error mapping (non-fatal unless stated):

- game not ongoing: `GAME_NOT_ONGOING`
- `cell` out of range, or a black square: `INVALID_CELL`
- `value` fails the pattern: `INVALID_VALUE`
- role too low for the message: `ROLE_FORBIDDEN`
- over a rate limit: `RATE_LIMITED`
- duplicate `commandId`: dropped silently; no error, no event (the state it produced, if any, arrives via events or sync)

## 6. Server to client messages

**Sequenced events.** These carry `seq`, and they are exactly the messages that mutate durable state.

`cellSet`, emitted for every accepted `placeLetter` or `clearCell`, including overwrites:

```json
{
  "type": "cellSet",
  "seq": 413,
  "cell": 17,
  "value": "A",
  "by": "<userId>",
  "commandId": "<origin>",
  "at": "2026-07-07T19:02:11Z"
}
```

`value` is a string or `null` (a clear). `commandId` echoes the originating command so the writer can clear its optimistic overlay.

`gameCompleted`:

```json
{
  "type": "gameCompleted",
  "seq": 900,
  "at": "2026-07-07T19:40:03Z",
  "stats": {
    "solveTimeSeconds": 2272,
    "totalEvents": 899,
    "participantCount": 4
  }
}
```

`gameAbandoned`:

```json
{ "type": "gameAbandoned", "seq": 641, "at": "...", "by": "<userId>" }
```

**Ephemeral notices.** No `seq`.

- `welcome`, `sync` (`{"type":"sync","board":{...}}`)
- `playerConnected {userId, displayName, color, role}` and `playerDisconnected {userId}`
- `cursor {userId, cell, direction}`
- `checkResult {commandId, wrongCells:[int]}`: unicast to the requester. Lists filled cells whose value fails the comparator; empty cells are never listed.
- `kicked {reason}`, followed by close `1008`.
- `error {code, message, fatal, commandId?}`

## 7. Ordering, delivery, reconnect

- Per connection, sequenced events arrive in strictly ascending `seq`. A client applies an event iff `event.seq == lastApplied + 1`.
- **Gap** (`event.seq > lastApplied + 1`): send `requestSync`. Do not buffer or guess; apply the `sync` snapshot wholesale, then resume applying events.
- **Stale** (`event.seq <= lastApplied`): discard.
- **Reconnect backoff**: delays of 0, 1, 2, 4, 8, 16, then 30 seconds, capped at 30, each with full jitter. Reset the schedule after a connection survives 30 seconds. (The two v3 documents disagreed on the cap, 16 vs 30; 30 is chosen here.)
- On reconnect: a fresh `hello`; the server replies `welcome` with a full snapshot. The client replaces all sequenced state, re-renders, and re-applies its optimistic overlay for commands still pending. It MAY re-send pending commands; duplicates are dropped by `commandId`, so re-sending is always safe.
- **Crash rollback rule.** After a session-service crash, the snapshot's `seq` MAY be lower than the client's `lastApplied` (bounded loss; DESIGN.md D14 and INV-5). The client MUST accept the snapshot and roll back. It SHOULD re-send its own pending commands. It MUST NOT refuse or "wait out" the lower seq.

## 8. Optimistic UI and conflict visibility (client requirements)

- Maintain an overlay, `commandId -> {cell, value}`, for sent-but-unconfirmed mutations. Render the overlay on top of sequenced state (DESIGN.md INV-10).
- On a `cellSet` carrying your `commandId`: delete that overlay entry.
- On a `cellSet` from another user that changes a cell you currently render with a different non-null value (sequenced or overlay): apply it, and flash the cell in the writer's color for roughly 300 ms. This is the entire conflict UX. Nothing is rejected, and nothing may change silently.
- On `sync`: clear the overlay, re-add entries only for commands still unconfirmed, then re-render.

## 9. Presence, heartbeat, cursors

- Clients send `heartbeat` every 15 s. The server broadcasts `playerDisconnected` after 45 s without one, or on socket close.
- `moveCursor` at most 10 per second per client; the server MAY drop excess silently.
- Presence and cursor state are best-effort: never persisted, never sequenced. The board payload carries the current view at snapshot time.

## 10. Completion and check

- The server tracks `filledCount`. When it equals the playable-cell count, the server validates the whole board against the solution. Pass: exactly one `gameCompleted`, persisted before broadcast. Fail: nothing is emitted; play continues.
- After `gameCompleted` or `gameAbandoned`: `placeLetter`, `clearCell`, and `checkRequest` receive `GAME_NOT_ONGOING`. The connection stays open for the post-game screen.
- `checkRequest` compares only filled cells and unicasts `checkResult`. Client guidance, non-normative: render wrong cells in the check style until the cell is next edited.
- **Comparator, normative** (mirrored in vectors): a filled value passes for a cell iff, case-insensitively, it equals the cell's full solution string, or it equals the solution's first character.

## 11. Errors

| code                           | fatal  | meaning                                                  |
| ------------------------------ | ------ | -------------------------------------------------------- |
| `UNAUTHORIZED`                 | yes    | bad or missing token, or the first frame was not `hello` |
| `NOT_PARTICIPANT`              | yes    | authenticated, but not a member of this game             |
| `DENIED`                       | yes    | on the game's denylist                                   |
| `GAME_NOT_FOUND`               | yes    | unknown `gameId`                                         |
| `PROTOCOL_VERSION_UNSUPPORTED` | yes    | version outside {N, N-1}                                 |
| `GAME_NOT_ONGOING`             | no     | mutation after a terminal state                          |
| `INVALID_CELL`                 | no     | out of range, or a black square                          |
| `INVALID_VALUE`                | no     | fails `^[A-Z0-9]{1,10}$`                                 |
| `ROLE_FORBIDDEN`               | no     | a spectator sent a mutation                              |
| `RATE_LIMITED`                 | no     | slow down                                                |
| `UNKNOWN_TYPE`                 | no     | unrecognized command type                                |
| `INTERNAL`                     | varies | server fault; `fatal:true` means reconnect               |

Fatal errors are followed by close `1008`. Non-fatal errors include `commandId` when the offending command carried one.

## 12. REST companion

The WebSocket carries gameplay only. Everything else is REST on the core API, bearer-authenticated with the same tokens. Listed here so this document reads standalone; the API's own contract lives with the API.

| Route                                 | Who                                     | Behavior                                                                                                                       |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /puzzles`                       | full account                            | ingest XWord Info JSON (body or URL); returns the puzzle view, or a named rejection (barred, diagramless, uniclue, over 25x25) |
| `POST /games`                         | full account                            | `{puzzleId}` creates a game; returns the game and its invite code                                                              |
| `POST /games/{id}/join`               | any authenticated user, guests included | `{code}` creates membership with role `spectator`                                                                              |
| `POST /games/{id}/role`               | member                                  | self-upgrade `spectator` to `solver`                                                                                           |
| `DELETE /games/{id}/members/{userId}` | host                                    | kick: removes membership, writes the denylist, disconnects live sockets                                                        |
| `POST /games/{id}/abandon`            | host                                    | terminal state, executed via the session service                                                                               |
| `GET /games/{id}`                     | member                                  | the game view: solution-stripped puzzle, membership, session endpoint                                                          |
| `GET /g/{code}`                       | public                                  | HTML shell with OpenGraph tags for link unfurlers                                                                              |

Puzzle views strip solutions, including answers embedded in clue structures.

## 13. Conformance vectors

Location: `vectors/` at the repo root. JSON files, one per behavior cluster, each an array of cases. Two runners consume the same files in CI: vitest for the TypeScript engine, XCTest for the Swift port. A divergence between runners, or between a runner and this document, is a build failure. Vectors are normative over this prose.

**Reducer vectors**, case shape:

```json
{
  "name": "overwrite flips value and attribution",
  "given": {
    "cols": 5,
    "rows": 4,
    "blocks": [2, 6, 13],
    "status": "ongoing",
    "seq": 7,
    "cells": { "0": { "v": "A", "by": "u1" } }
  },
  "when": [
    {
      "type": "placeLetter",
      "commandId": "c9",
      "cell": 0,
      "value": "B",
      "by": "u2",
      "at": "2026-07-07T00:00:01Z"
    }
  ],
  "then": {
    "events": [
      {
        "type": "cellSet",
        "seq": 8,
        "cell": 0,
        "value": "B",
        "by": "u2",
        "commandId": "c9"
      }
    ],
    "state": {
      "cells": { "0": { "v": "B", "by": "u2" } },
      "filledCount": 1,
      "seq": 8
    }
  }
}
```

`given.cells` and `then.state.cells` are sparse maps; unlisted playable cells are null.

**Comparator vectors**, case shape:

```json
{
  "solution": "XRAY",
  "accept": ["XRAY", "xray", "X", "x"],
  "reject": ["XR", "RAY", "Y", ""]
}
```

**Navigation vectors**, seeded verbatim from v2's proven behavior. The shared fixture is 5 columns by 4 rows with blocks at indices 2, 6, 13:

```
A B . D E
F . H I J
K L M . O
P Q R S T
```

The ten seed cases for single-cell advance (`getNextCell`):

| #   | scenario                           | direction, from, toward | extras              | expect |
| --- | ---------------------------------- | ----------------------- | ------------------- | ------ |
| 1   | next cell across                   | across, 0, forward      |                     | 1      |
| 2   | previous cell across               | across, 1, backward     |                     | 0      |
| 3   | crosses into next row              | across, 4, forward      |                     | 5      |
| 4   | clamps at grid bottom              | down, 15, forward       |                     | 15     |
| 5   | skips a block across               | across, 1, forward      |                     | 3      |
| 6   | skips a block down                 | down, 1, forward        |                     | 11     |
| 7   | no skipping when escape disabled   | across, 0, forward      | canEscapeWord=false | 1      |
| 8   | skipping when escape enabled       | across, 1, forward      | canEscapeWord=true  | 3      |
| 9   | empty grid is a no-op              | across, 0, forward      | empty grid          | 0      |
| 10  | invalid start clamps to first cell | across, -1, forward     |                     | 0      |

Planned additions under the same fixture: word-bounds cases, next-word (Tab) including the wrap to the grid's first playable cell, Tab landing on a clue's first empty cell (start or end when the clue is full), typing wrap at word end (incomplete wraps to start, complete stays), and backspace stepping back through an already-empty cell.

**Completion matrix vectors** (reducer cases plus actor integration): repeated completion attempts yield exactly one `gameCompleted`; a filled-but-wrong board emits nothing and stays `ongoing`; two players filling the last two cells concurrently yield exactly one completion; any mutation after completion is rejected; a client disconnected across the completion learns of it from the snapshot.

## 14. Versioning

- `protocolVersion` bumps on any breaking change: removing or retyping a field, changing semantics, adding a required field. Additive optional fields do not bump; clients already ignore unknowns.
- The server supports N and N-1. The deprecation window follows the iOS release cadence; App Store review lag is the reason N-1 exists at all.
- Every bump requires: a changelog entry here, updated vectors, and both clients green in CI before deploy.

Changelog: v1, 2026-07-07, initial.
