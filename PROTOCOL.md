# Crossy Realtime Protocol, version 1

Status: draft 1, for review. Date: 2026-07-07.
Consumers: the session service (TypeScript), the web client (TypeScript), the iOS client (Swift).
Precedence when sources disagree: conformance vectors, then this document, then any implementation. For facts this protocol owns — wire format, message schemas, completion and comparator semantics, reconnect, roles — this document is normative over `DESIGN.md` prose, which links rather than restates.
Key words MUST, SHOULD, MAY follow RFC 2119.

## 1. Principles

- **Server-authoritative.** The session service assigns the order of all board mutations. Clients predict locally, then reconcile to the server's order.
- **Sequenced events vs ephemeral notices.** Anything that changes durable game state carries a per-game sequence number (`seq`). Presence and cursors do not.
- **Per-cell last-write-wins under a total order.** There is no compare-and-swap and no conflict message; the later event stands, attributed to its writer.
- **Full-snapshot resync.** Reconnection always transfers the whole board — at the 25x25 cap, roughly 30 KB of raw JSON (a per-cell `{v, by}` with a UUID `by`), well under 20 KB with `permessage-deflate`, which the repeated nulls and handful of participant UUIDs compress heavily. There are no deltas.
- **Idempotent commands.** Every mutating command carries a client-generated `commandId`. The server drops duplicates silently, so re-sending a command still within the recent-command window is safe (section 8); a command that has aged out of the window is dropped by the client rather than re-sent, since re-applying it could regress newer state.

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

- `token`: the identity provider's access token. The server verifies it locally against the provider's published keys, resolves the user, and checks the denylist and membership for `gameId` (order pinned below).
- `protocolVersion`: integer. The server supports the current version N and N-1. Anything else: `error PROTOCOL_VERSION_UNSUPPORTED` (fatal, message names the supported range), then close. At v1 the supported set is exactly `{1}`: N-1 is 0, which is not a real version, and frozen `vN-1` vectors exist only after the first bump (section 14). The range widens to `{N-1, N}` from v2 on.
- `resumeFromSeq`: optional and informational; the server replies with a full snapshot regardless.

**Handshake check order.** After the first-frame-is-`hello` gate above, the server runs the fatal checks in this fixed order and returns the first failure: protocol version (`PROTOCOL_VERSION_UNSUPPORTED`), token (`UNAUTHORIZED`), game exists (`GAME_NOT_FOUND`), denylist (`DENIED`), then membership (`NOT_PARTICIPANT`). The denylist is checked strictly before membership. A kick removes the membership row and writes the denylist (section 12), so a kicked user has no membership: if membership ran first the server would answer `NOT_PARTICIPANT` and `DENIED` would be unreachable for exactly the kicked users it exists for. Denylist-first surfaces the informative `DENIED` to a kicked user.

`welcome` (server to client) on success:

```json
{"type":"welcome","protocolVersion":1,"self":{"userId":"...","role":"solver"},"board":{ ... }}
```

**Open question (unresolved):** which version `welcome.protocolVersion` echoes once N-1 is a real version. When a client speaks N-1, the server could echo the negotiated version (N-1) or its own current N. At v1 this is moot because the supported set is `{1}`, so the field is always `1`; a ruling is due before the first version bump.

The connection is then live: the server pushes events and notices; the client may send commands.

Close codes: `1000` normal, `1008` after any fatal error, `1001` server shutdown (clients reconnect on `1001`).

## 3. Conventions

- `type`: string, camelCase, required on every message.
- `cell`: integer index into the row-major grid, 0-based. `row = floor(cell / cols)`, `col = cell mod cols`.
- Values: strings matching `^[A-Z0-9]{1,10}$` after normalization. Normalization is ASCII-only (`a-z` to `A-Z`, every other code point unchanged); locale-aware casing MUST NOT be used, so the TypeScript and Swift ports agree byte for byte (INV-1). Clients SHOULD uppercase before sending; the server normalizes regardless. `null` means empty. Multi-character values are rebus entries.
- `seq`: integer, per game, starting at 1, contiguous, assigned only by the server.
- `commandId`: client-generated UUIDv4, unique per command.
- `at`: ISO 8601 UTC timestamp, server clock only. Clients never supply timestamps.
- Unknown fields MUST be ignored (forward compatibility). Unknown notice types from the server: ignore and log. This holds whether or not the unknown type would have carried a `seq`; the receiver cannot tell, and section 7's contiguous-`seq` check then resyncs if a `seq` was in fact skipped. A genuinely new sequenced event type is a breaking change that bumps the version (section 14), so it never appears within a negotiated version. Unknown command types from a client: `error UNKNOWN_TYPE` (non-fatal).

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
  "recentCommandIds": ["<uuid>", "..."],
  "stats": null
}
```

- `cells` has length `rows * cols`. Black squares are present, always `{"v":null,"by":null}`, and immutable. A cleared or no-op'd playable cell keeps a non-null `by` (the writer or clearer), so `{"v":null,"by":null}` is reserved for black squares and never-written cells, while `{"v":null,"by":"<userId>"}` is a cell a writer set or cleared to null. This matches section 6 (a `cellSet` for a clear updates `by`) and the reducer vectors (section 13), which list such cells explicitly in `then.state.cells`.
- `status` is one of `ongoing`, `completed`, `abandoned`. `stats` is non-null only when completed: `solveTimeSeconds` = `completedAt` − `firstFillAt`; `totalEvents` = the terminal event's `seq` − 1 (the count of sequenced events before it); `participantCount` = distinct users who sent at least one accepted mutation (not mere joiners, not spectators), computed as `DISTINCT user_id` over `cell_events` on the completion path, since it is not derivable from the board snapshot (last writer per cell only) nor from actor memory (lost on passivation).
- `recentCommandIds` is the last K applied `commandId`s, letting a client confirm and clear overlay entries whose echo fell inside a gap (section 8; DESIGN.md section 6).
- Solutions are never present in any message on this protocol (DESIGN.md INV-6).

## 5. Client to server messages

| type           | role required     | fields                       | notes                              |
| -------------- | ----------------- | ---------------------------- | ---------------------------------- |
| `hello`        | any authenticated | see section 2                | first frame only                   |
| `placeLetter`  | host, solver      | `commandId`, `cell`, `value` | board mutation                     |
| `clearCell`    | host, solver      | `commandId`, `cell`          | board mutation; value becomes null |
| `moveCursor`   | any               | `cell`, `direction`          | ephemeral; at most 10/s; spectator cursors suppressed client-side by default |
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

**Client send guidance (non-normative).** A client SHOULD suppress a clear that would be a no-op: pressing Space or Backspace on an already-empty cell sends nothing. The server accepts such a `clearCell` and still emits one `cellSet` for it (section 6), which consumes a `seq` for no state change, so not sending it is the client-side optimization. This is guidance, not a validation rule: a no-op clear that does arrive is accepted and echoed like any other.

## 6. Server to client messages

**Sequenced events.** These carry `seq`, and they are exactly the messages that mutate durable state.

`cellSet`, emitted for **every** accepted `placeLetter` or `clearCell` — including overwrites and no-ops (a `placeLetter` with the current value, a `clearCell` on an empty cell). Exactly one `cellSet` per accepted command, so the writer always receives an echo to clear its overlay (INV-10) and the server never silently swallows an accepted command. A no-op still consumes a `seq` and updates `by`; it does not move `firstFillAt`. (A duplicate `commandId` is the distinct case in section 5: dropped, no event.)

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

`at` and `stats` are actor-supplied, not engine output. The reducer's completion result carries neither: `gameCompleted` at the next `seq` is all the engine emits (the completion vectors, section 13, pin no `stats`). The session adapter stamps `at` from the server clock and fills `stats` (`solveTimeSeconds` from the timestamps, `totalEvents` and `participantCount` as section 4 defines) before broadcast.

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
- On reconnect: a fresh `hello`; the server replies `welcome` with a full snapshot. The client replaces all sequenced state, re-renders, and runs snapshot reconciliation (section 8) against `welcome.board.recentCommandIds` — the same procedure as `sync`, not a weaker one. Re-sending is safe only for commands still within the recent-command window (section 8).
- **Crash rollback rule.** After a session-service crash, the snapshot's `seq` MAY be lower than the client's `lastApplied` (bounded loss; DESIGN.md D14 and INV-5). The client MUST accept the snapshot and roll back, running snapshot reconciliation (section 8): re-send pending commands still within the window, drop those aged out. It MUST NOT refuse or "wait out" the lower seq.
- **Connection states (client).** A client tracks one of three connection states, named here so the two client stores cannot drift (asserted by the client-store vectors, section 13): `live` (applying events in order), `resyncing` (a gap was seen and `requestSync` sent; the next full snapshot is applied wholesale and sequenced events are ignored until it arrives), and `reconnecting` (the socket closed after a fatal error or transport drop; backoff runs and the reconnect `welcome` snapshot reconciles). These name the behaviors above; they add no wire message.

## 8. Optimistic UI and conflict visibility (client requirements)

- Maintain an overlay, `commandId -> {cell, value}`, for sent-but-unconfirmed mutations. Render the overlay on top of sequenced state (DESIGN.md INV-10).
- On a `cellSet` carrying your `commandId`: delete that overlay entry.
- On a non-fatal `error` carrying your `commandId`: delete that overlay entry and surface the rejection. The command was not applied and produced no `seq` (so it triggers no gap); it MUST NOT be re-sent on a later snapshot. Without this rule a rejected optimistic letter (e.g. a `placeLetter` that raced a `gameCompleted` into `GAME_NOT_ONGOING`, or one refused by `ROLE_FORBIDDEN`/`RATE_LIMITED`) would mask the cell's true value forever, since no echo and no gap ever arrive to clear it.
- If several pending entries target one cell, render the most recently sent.
- On a `cellSet` from another user for a cell where you currently render a **non-null** value (sequenced or overlay) that the event changes — to a different letter, or to `null` (a clear) — apply it, and flash the cell in the writer's color for roughly 300 ms. The trigger is a change to *your currently-rendered non-null* value, not the incoming value, so an erase of your letter is never silent (D02); filling a cell you render as empty does not flash. This is the entire conflict UX. Nothing is rejected, and nothing may change silently.
- **Snapshot reconciliation**, used identically for every full snapshot (`welcome`, `sync`, and a crash-rollback snapshot) so the paths cannot drift: clear the overlay, then for each still-pending command, if its `commandId` is in the snapshot's `recentCommandIds` it is confirmed — drop it; otherwise, if the command is still within the recent-command window (K; DESIGN.md section 15), re-add its overlay entry **and re-send it** (MUST after a gap or reconnect, not MAY); if it has aged out of the window, drop it rather than re-send, because re-applying it could regress a value that superseded it. Duplicates are dropped by `commandId`. This stops an overlay entry whose echo was lost in a gap or disconnect from becoming immortal and masking a later write to that cell. Then re-render.
- **Age against K, proposal (not settled).** The rule above re-sends a pending command that is still within the window K and drops it once it has aged out, but it does not fix how a client measures a pending command's age against K. The unit is unspecified: a send-`seq` delta, an applied-command count, or wall-clock time are all candidates. Proposal: measure by `seq` delta, since the server's K counts applied commands and every accepted command consumes exactly one `seq` (section 6). A pending command has aged out when a reconciling snapshot's `board.seq` exceeds the `seq` the client had applied when it sent the command by more than K (a conservative bound, since terminal events also consume `seq`). The client-store vectors (section 13) supply `agedOut` as case input rather than deriving it, so they pin the outcome (aged-out drops, live re-sends) without committing to a measure; until this closes (DESIGN.md section 15, by M2) implementations MUST NOT diverge on the measure.

## 9. Presence, heartbeat, cursors

- Clients send `heartbeat` every 15 s. The server broadcasts `playerDisconnected` after 45 s with no inbound frame of any type (heartbeat or command), or on socket close; any received frame resets the liveness timer, so an actively typing client never flaps to disconnected.
- `moveCursor` at most 10 per second per client; the server MAY drop excess silently.
- Presence and cursor state are best-effort: never persisted, never sequenced. The board payload carries the current view at snapshot time.

## 10. Completion and check

- The server tracks `filledCount`. After every accepted mutation, while `filledCount` equals the playable-cell count (including a same-value or corrective overwrite that does not change the count), the server MUST validate the whole board against the solution. The check is level-triggered, not edge-triggered: it MUST re-run on a same-count overwrite, so a full-but-wrong board corrected in place still completes. Pass: exactly one `gameCompleted`, persisted before broadcast. Fail: nothing is emitted; play continues.
- After `gameCompleted` or `gameAbandoned`: `placeLetter`, `clearCell`, and `checkRequest` receive `GAME_NOT_ONGOING`. The connection stays open for the post-game screen. A terminal state is final: a second `abandon`, or a late completion attempt, is a no-op (INV-4).
- `checkRequest` compares only filled cells and unicasts `checkResult`. Client guidance, non-normative: render wrong cells in the check style until the cell is next edited.
- **Comparator, normative** (mirrored in vectors): a filled value passes for a cell iff, case-insensitively, it equals the cell's full solution string, or it equals the solution's first character.
- **Open question (unresolved):** whether the full-string branch accepts a solution string that no legal input can produce. For a rebus solution like `A/B`, the string `A/B` fails the `^[A-Z0-9]{1,10}$` charset, so it can never be entered, yet the literal rule above would still "match" it. The comparator vectors pin the enterable cases (solution `A/B` accepts `A`/`a`, rejects `B`/`AB`) but deliberately leave the unenterable full string `A/B` in neither `accept` nor `reject`. It is moot at runtime, because ingestion rejects whole-symbol cells (section 12; DESIGN.md section 7) and the input charset blocks entry, but the rule text is silent. Resolve before the comparator is considered final.

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

Fatal errors are followed by close `1008`. Non-fatal errors include `commandId` when the offending command carried one; the client clears the matching overlay entry (section 8).

**Malformed frames after a successful handshake.** A frame that is not valid JSON, or a JSON object whose `type` is missing or not a string, has no `type` to key on and no code in the table above. The v1 posture is drop-and-log: the session service discards the frame, logs it, and sends nothing. This is distinct from an object with a recognizable but unsupported command `type`, which is the `UNKNOWN_TYPE` case (section 5) and does reply. A dedicated malformed-frame wire error was considered and deliberately not added for v1: the client cannot act on it, since the frame that would carry a `commandId` is the one that failed to parse, and drop-and-log keeps a garbled or hostile peer from steering server replies. (During the handshake itself, a non-`hello` or unparseable first frame is the fatal `UNAUTHORIZED` in section 2, not a drop.)

## 12. REST companion

The WebSocket carries gameplay only. Everything else is REST on the core API, bearer-authenticated with the same tokens. Listed here so this document reads standalone; the API's own contract lives with the API.

| Route                                 | Who                                     | Behavior                                                                                                                       |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `POST /puzzles`                       | full account                            | ingest XWord Info JSON (body or URL); returns the puzzle view, or a named rejection (barred, diagramless, uniclue, over 25x25, degenerate/zero playable cells, unsolvable/non-enterable solution cell) |
| `POST /games`                         | full account                            | `{puzzleId}` creates a game; returns the game and its invite code                                                              |
| `POST /games/{id}/join`               | any authenticated user, guests included | `{code}` creates membership with role `spectator`                                                                              |
| `POST /games/{id}/role`               | member                                  | self-upgrade `spectator` to `solver`                                                                                           |
| `DELETE /games/{id}/members/{userId}` | host                                    | kick: removes membership, writes the denylist, disconnects live sockets; the host MUST NOT target themselves (`403`) |
| `POST /games/{id}/abandon`            | host                                    | terminal state, executed via the session service                                                                               |
| `GET /games/{id}`                     | member                                  | the game view: solution-stripped puzzle, membership, session endpoint                                                          |
| `GET /g/{code}`                       | public                                  | HTML shell with OpenGraph tags for link unfurlers                                                                              |

Puzzle views are typed `ClientPuzzle` — a type with no solution field, including none embedded in clue structures — so stripping is structural, not runtime (DESIGN.md INV-6).

Unlike every WebSocket message in this document, the puzzle payload carries no literal example here, by design: it is a REST payload owned by ingestion (DESIGN.md section 7), and its full schema (image clues, cross-references, per-cell numbering) is ingestion's to pin. A literal `ClientPuzzle`/`ServerPuzzle` example and its serialization golden land with the ingestion slice (DESIGN.md section 7), not in this document; the load-bearing fact here is only the solution split (INV-6).

**REST error vocabulary.** These codes are the API's own contract (`apps/api/src/http/errors.ts`), listed here so this document reads standalone. Every REST failure returns a small JSON body `{ error, message }` plus the matching HTTP status, so a client keys on a stable string, never on prose. The surface reuses the section 11 names that carry the same meaning across the wire and adds the REST-only codes it needs:

| code                    | HTTP | meaning                                                        |
| ----------------------- | ---- | ------------------------------------------------------------- |
| `UNAUTHORIZED`          | 401  | bad or missing bearer token                                   |
| `FULL_ACCOUNT_REQUIRED` | 403  | a guest attempted a create action (DESIGN.md section 8)       |
| `NOT_PARTICIPANT`       | 403  | authenticated, but not a member of this game                  |
| `DENIED`                | 403  | on the game's denylist, or a wrong invite code                |
| `GAME_NOT_FOUND`        | 404  | unknown `gameId`                                              |
| `PUZZLE_NOT_FOUND`      | 404  | unknown `puzzleId`                                            |
| `VALIDATION`            | 400  | malformed or missing request body                             |

Puzzle ingestion (`POST /puzzles`) rejects an unacceptable puzzle with a named reason, so the user reads why (DESIGN.md section 7). The named ingestion rejections from the SP5 corpus study (`reports/spikes/sp5-puzzle-corpus.md`):

| code                 | meaning                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNSOLVABLE_CELL`    | a solution cell no legal input can satisfy: ASCII-uppercased it is non-empty, its first character is not in `A-Z0-9`, and the whole string fails `^[A-Z0-9]{1,10}$` (a whole-cell symbol such as `/` or `+`) |
| `REBUS_TOO_LONG`     | a cell whose canonical solution exceeds 10 characters; a named rejection, never a silent truncation                                                             |
| `OVERSIZE_GRID`      | a grid past the 25x25 cap, with both dimensions checked independently since real grids are non-square and may be even-dimensioned                               |
| `AMBIGUOUS_SOLUTION` | a Schrodinger or multi-clue-per-slot puzzle the one-solution-per-cell model cannot represent                                                                    |

Barred, diagramless, uniclue, and degenerate grids (section 12 table; DESIGN.md section 7) reject on the same reason-per-rejection contract; their exact code strings are the ingestion track's to fix. Asymmetric grids and unchecked cells are valid puzzles and are never rejected (SP5).

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

`given.cells` and `then.state.cells` are sparse maps; unlisted playable cells are null. No-op vectors are required: a `placeLetter` with the current value still emits one `cellSet` (new `seq`, `by` updated, `firstFillAt` unchanged), and a `clearCell` on an already-null cell emits one `cellSet` with `value: null`.

The shape above lists only `events` and `state`, so it cannot express a rejection. Rejections use one convention, normative here: a rejected command produces no sequenced event and no state change. Its case sets `then.events` to `[]`, `then.state` to the unchanged state (`seq` included, since a rejection consumes no `seq`; INV-2), and `then.error` to the section 11 code the rejection maps to (`GAME_NOT_ONGOING`, `INVALID_VALUE`, and so on). This distinguishes a rejection from an accepted no-op, which always emits one `cellSet`. `then.error` extends the reducer shape; it is unasserted when absent.

**Comparator vectors**, case shape:

```json
{
  "solution": "XRAY",
  "accept": ["XRAY", "xray", "X", "x"],
  "reject": ["XR", "RAY", "Y", ""]
}
```

Casing is ASCII-only and identical across ports (INV-1). A vector pins it: solution `"ISTANBUL"` accepts `"i"` and `"I"` (first-char, both ASCII) and rejects `"İ"` (U+0130) and `"ı"` (U+0131), so a Turkish-locale client cannot diverge.

**Navigation vectors**, seeded verbatim from v2's proven behavior. The shared fixture is 5 columns by 4 rows with blocks at indices 2, 6, 13:

```
A B . D E
F . H I J
K L M . O
P Q R S T
```

The seed cases for single-cell advance (`getNextCell`); `canEscapeWord` semantics are defined in DESIGN.md section 5, and cases 7/8/11/12 form controlled pairs that isolate the flag (same start cell, flag flipped):

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
| 11  | escape disabled holds at word end  | across, 1, forward      | canEscapeWord=false | 1      |
| 12  | escape is a no-op mid-word         | across, 0, forward      | canEscapeWord=true  | 1      |

Cases 8 vs 11 (both start at 1, forward) isolate the flag: 3 with escape, 1 without. Cases 7 vs 12 (both start at 0, forward) show it is a mid-word no-op: 1 either way.

Planned additions under the same fixture: word-bounds cases, next-word (Tab) including the wrap to the grid's first playable cell, Tab landing on a clue's first empty cell (start or end when the clue is full), typing wrap at word end (incomplete wraps to start, complete stays), and backspace stepping back through an already-empty cell.

**Completion matrix vectors** (reducer cases plus actor integration): repeated completion attempts yield exactly one `gameCompleted`; a filled-but-wrong board emits nothing and stays `ongoing`; **a full-but-wrong board made correct by an in-place overwrite (no change to `filledCount`) completes exactly once**; two players filling the last two cells concurrently yield exactly one completion; any mutation after completion is rejected; a client disconnected across the completion learns of it from the snapshot.

**Client-store vectors** (run in both vitest and XCTest, like the engine): given sequenced state plus an overlay plus an incoming message (`cellSet`, `error`, `sync`, or a crash-rollback snapshot), assert the resulting overlay and rendered cells. A non-fatal `error` is in scope because it is what clears the immortal overlay (section 8), the case this family must cover. These pin the duplicated web + iOS reconciliation logic — overlay clear on echo, gap-to-sync re-send, rollback — where drift is most expensive, and cover the immortal-overlay case in section 8.

## 14. Versioning

- `protocolVersion` bumps on any breaking change: removing or retyping a field, changing semantics, adding a required field. Additive optional fields do not bump; clients already ignore unknowns.
- The server supports N and N-1. The deprecation window follows the iOS release cadence; App Store review lag is the reason N-1 exists at all.
- Every bump requires: a changelog entry here, updated vectors, the prior version's vectors frozen under `vectors/frozen/vN-1/` and run in CI against the current server (otherwise "supports N-1" is asserted, not tested), and both clients green in CI before deploy.

Changelog: v1, 2026-07-07, initial.
