# Crossy Realtime Protocol, version 1

Status: draft 1, for review. Date: 2026-07-07.
Consumers: the session service (TypeScript), the web client (TypeScript), the iOS client (Swift).
Precedence when sources disagree: conformance vectors, then this document, then any implementation. For facts this protocol owns (wire format, message schemas, completion and comparator semantics, reconnect, roles), this document is normative over `DESIGN.md` prose, which links rather than restates.
Key words MUST, SHOULD, MAY follow RFC 2119.

## 1. Principles

- **Server-authoritative.** The session service assigns the order of all board mutations. Clients predict locally, then reconcile to the server's order.
- **Sequenced events vs ephemeral notices.** Anything that changes durable game state carries a per-game sequence number (`seq`). Presence and cursors do not.
- **Per-cell last-write-wins under a total order.** There is no compare-and-swap and no conflict message; the later event stands, attributed to its writer.
- **Full-snapshot resync.** Reconnection always transfers the whole board: at the 25x25 cap, roughly 30 KB of raw JSON (a per-cell `{v, by}` with a UUID `by`), well under 20 KB with `permessage-deflate`, which the repeated nulls and handful of participant UUIDs compress heavily. There are no deltas.
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
  "checkedWrongCells": [3, 17],
  "checkCount": 1,
  "participants": [ {"userId":"...","displayName":"Ana","avatarUrl":"https://...","color":"#7F77DD","role":"host","connected":true} ],
  "cursors": [ {"userId":"...","cell":17,"direction":"across"} ],
  "recentCommandIds": ["<uuid>", "..."],
  "stats": null
}
```

- `cells` has length `rows * cols`. Black squares are present, always `{"v":null,"by":null}`, and immutable. A cleared or no-op'd playable cell keeps a non-null `by` (the writer or clearer), so `{"v":null,"by":null}` is reserved for black squares and never-written cells, while `{"v":null,"by":"<userId>"}` is a cell a writer set or cleared to null. This matches section 6 (a `cellSet` for a clear updates `by`) and the reducer vectors (section 13), which list such cells explicitly in `then.state.cells`.
- `checkedWrongCells` is the standing room-check marks (section 10): the playable cells whose value failed the comparator at the game's most recent `checkPuzzle` and whose value has not changed since, ascending, `[]` when none stand. `checkCount` is the game's total accepted checks, `0` before the first. Both are cell indices and a count, never values or answers (INV-6). They ride every snapshot, so reconnect and resync heal the marks with no delta replay.
- `status` is one of `ongoing`, `completed`, `abandoned`. `stats` is non-null only when completed: `solveTimeSeconds` = `completedAt` − `firstFillAt`; `totalEvents` = the terminal event's `seq` − 1 (the count of sequenced events before it); `participantCount` = distinct users who sent at least one accepted mutation (not mere joiners, not spectators), computed as `DISTINCT user_id` over `cell_events` on the completion path, since it is not derivable from the board snapshot (last writer per cell only) nor from actor memory (lost on passivation); `checkCount` = the same permanent count the board payload carries, frozen at completion.
- `recentCommandIds` is the last K applied `commandId`s, letting a client confirm and clear overlay entries whose echo fell inside a gap (section 8; DESIGN.md section 6).
- Each participant carries `avatarUrl`, an opaque nullable string. It is resolved server-side, once, where the display name is (DESIGN.md section 8), and is the same field on every participant-carrying payload: the `welcome` and `sync` participants, `playerConnected` (section 6), and the `GET /games/{id}` member listing (section 12). A client renders the image when it is present and falls back to its existing initial avatar when it is `null`, while loading, or on a load error; `null` is a first-class value, not an error. The value is opaque by contract: a client MUST NOT infer which provider produced it or reconstruct any input to it. The server never puts an email or any hash input on the wire (DESIGN.md INV-6 spirit).
- Solutions are never present in any message on this protocol (DESIGN.md INV-6).

## 5. Client to server messages

| type           | role required     | fields                       | notes                              |
| -------------- | ----------------- | ---------------------------- | ---------------------------------- |
| `hello`        | any authenticated | see section 2                | first frame only                   |
| `placeLetter`  | host, solver      | `commandId`, `cell`, `value` | board mutation                     |
| `clearCell`    | host, solver      | `commandId`, `cell`          | board mutation; value becomes null |
| `moveCursor`   | any               | `cell`, `direction`          | ephemeral; at most 10/s; spectator cursors suppressed client-side by default |
| `react`        | any               | `emoji`, `cell`              | ephemeral; at most 5/s; any role incl. spectator; legal in any status (section 9) |
| `checkPuzzle`  | host, solver      | `commandId`                  | room-wide check; grid must be full |
| `heartbeat`    | any               | none                         | every 15 s                         |
| `requestSync`  | any               | none                         | server replies `sync`              |

`direction` is `"across"` or `"down"`.

Validation and error mapping (non-fatal unless stated):

- game not ongoing: `GAME_NOT_ONGOING`
- `cell` out of range, or a black square: `INVALID_CELL`
- `value` fails the pattern: `INVALID_VALUE`
- `checkPuzzle` while any playable cell is empty: `GRID_NOT_FULL`
- role too low for the message: `ROLE_FORBIDDEN`
- over a rate limit: `RATE_LIMITED`
- duplicate `commandId`: dropped silently; no error, no event (the state it produced, if any, arrives via events or sync)

**Client send guidance (non-normative).** A client SHOULD suppress a clear that would be a no-op: pressing Space or Backspace on an already-empty cell sends nothing. The server accepts such a `clearCell` and still emits one `cellSet` for it (section 6), which consumes a `seq` for no state change, so not sending it is the client-side optimization. This is guidance, not a validation rule: a no-op clear that does arrive is accepted and echoed like any other.

## 6. Server to client messages

**Sequenced events.** These carry `seq`, and they are exactly the messages that mutate durable state.

`cellSet`, emitted for **every** accepted `placeLetter` or `clearCell`, including overwrites and no-ops (a `placeLetter` with the current value, a `clearCell` on an empty cell). Exactly one `cellSet` per accepted command, so the writer always receives an echo to clear its overlay (INV-10) and the server never silently swallows an accepted command. A no-op still consumes a `seq` and updates `by`; it does not move `firstFillAt`. (A duplicate `commandId` is the distinct case in section 5: dropped, no event.)

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

**First-fill timing on the delta path.** The single `cellSet` that establishes the first fill, the one whose `placeLetter` moves `firstFillAt` from null to its value, MUST carry an additional `firstFillAt` field, the same server timestamp section 4's board payload reports:

```json
{
  "type": "cellSet",
  "seq": 8,
  "cell": 0,
  "value": "A",
  "by": "<userId>",
  "commandId": "<origin>",
  "at": "2026-07-07T19:02:11Z",
  "firstFillAt": "2026-07-07T19:02:11Z"
}
```

It appears on exactly that one event and on no other `cellSet`: a later fill, an overwrite, a clear, or a no-op never carries it, matching the reducer's set-once rule (section 4). Its purpose is that a client already connected at the moment of the first fill starts the shared game timer (DESIGN.md section 2) from the delta, rather than waiting for its next snapshot. The field is additive and optional on the wire (section 14): a client that ignores it loses nothing, because the timer origin still arrives in every subsequent snapshot's `board.firstFillAt`. Because it rides the sequenced `cellSet`, it inherits section 7 ordering: it is applied under the same `seq == lastApplied + 1` gate, so a stale or redelivered frame never re-applies it, and a client sets its timer origin exactly once and never moves it. Reconnect is unchanged: the snapshot stays authoritative for `firstFillAt`, where this field is redundant.

`gameCompleted`:

```json
{
  "type": "gameCompleted",
  "seq": 900,
  "at": "2026-07-07T19:40:03Z",
  "stats": {
    "solveTimeSeconds": 2272,
    "totalEvents": 899,
    "participantCount": 4,
    "checkCount": 2
  }
}
```

`at` and `stats` are actor-supplied, not engine output. The reducer's completion result carries neither: `gameCompleted` at the next `seq` is all the engine emits (the completion vectors, section 13, pin no `stats`). The session adapter stamps `at` from the server clock and fills `stats` (`solveTimeSeconds` from the timestamps, `totalEvents` and `participantCount` as section 4 defines) before broadcast.

`puzzleChecked`, emitted for every accepted `checkPuzzle` (section 10) and broadcast to the whole room:

```json
{
  "type": "puzzleChecked",
  "seq": 742,
  "wrongCells": [3, 17, 44],
  "checkCount": 2,
  "commandId": "<origin>",
  "at": "2026-07-07T19:31:40Z"
}
```

`wrongCells` lists, ascending, every playable cell whose value fails the comparator (section 10) at the moment the check runs; cell indices only, never values or answers (INV-6). The gate in section 10 guarantees the grid is full when a check is accepted, so `wrongCells` is never empty (a full and correct board has already completed and a terminal board rejects the command). `checkCount` is the game's total accepted checks including this one; it is permanent state, never reset. The event deliberately carries no `by`: a check is a room act recorded neutrally, and no client can attribute it because the attribution never crosses the wire (the server retains the actor server-side, DESIGN.md section 9). The sender recognizes its own `commandId` echo, which is all a client needs. `at` is stamped by the session adapter from the server clock, like `gameCompleted`'s.

`gameAbandoned`:

```json
{ "type": "gameAbandoned", "seq": 641, "at": "...", "by": "<userId>" }
```

**Ephemeral notices.** No `seq`.

- `welcome`, `sync` (`{"type":"sync","board":{...}}`)
- `playerConnected {userId, displayName, avatarUrl, color, role}` and `playerDisconnected {userId}`. `avatarUrl` is the same opaque nullable field as the participant carries (section 4).
- `cursor {userId, cell, direction}`
- `reaction {userId, emoji, cell}`: relayed to the other connections on a valid `react`, never echoed to the sender (like `cursor`). Even lighter than a cursor: the server records nothing, so a reaction never appears in a `welcome` or `sync` `board` snapshot (there is no `board.reactions`). Semantics in section 9.
- `kicked {reason}`, followed by close `1008`.
- `error {code, message, fatal, commandId?}`

## 7. Ordering, delivery, reconnect

- Per connection, sequenced events arrive in strictly ascending `seq`. A client applies an event iff `event.seq == lastApplied + 1`.
- **Gap** (`event.seq > lastApplied + 1`): send `requestSync`. Do not buffer or guess; apply the `sync` snapshot wholesale, then resume applying events.
- **Stale** (`event.seq <= lastApplied`): discard.
- **Reconnect backoff**: delays of 0, 1, 2, 4, 8, 16, then 30 seconds, capped at 30, each with full jitter. Reset the schedule after a connection survives 30 seconds. (The two v3 documents disagreed on the cap, 16 vs 30; 30 is chosen here.)
- On reconnect: a fresh `hello`; the server replies `welcome` with a full snapshot. The client replaces all sequenced state, re-renders, and runs snapshot reconciliation (section 8) against `welcome.board.recentCommandIds`, the same procedure as `sync`, not a weaker one. Re-sending is safe only for commands still within the recent-command window (section 8).
- **Crash rollback rule.** After a session-service crash, the snapshot's `seq` MAY be lower than the client's `lastApplied` (bounded loss; DESIGN.md D14 and INV-5). The client MUST accept the snapshot and roll back, running snapshot reconciliation (section 8): re-send pending commands still within the window, drop those aged out. It MUST NOT refuse or "wait out" the lower seq.
- **Connection states (client).** A client tracks one of three connection states, named here so the two client stores cannot drift (asserted by the client-store vectors, section 13): `live` (applying events in order), `resyncing` (a gap was seen and `requestSync` sent; the next full snapshot is applied wholesale and sequenced events are ignored until it arrives), and `reconnecting` (the socket closed after a fatal error or transport drop; backoff runs and the reconnect `welcome` snapshot reconciles). These name the behaviors above; they add no wire message.

## 8. Optimistic UI and conflict visibility (client requirements)

- Maintain an overlay, `commandId -> {cell, value}`, for sent-but-unconfirmed mutations. Render the overlay on top of sequenced state (DESIGN.md INV-10).
- On a `cellSet` carrying your `commandId`: delete that overlay entry.
- On a non-fatal `error` carrying your `commandId`: delete that overlay entry and surface the rejection. The command was not applied and produced no `seq` (so it triggers no gap); it MUST NOT be re-sent on a later snapshot. Without this rule a rejected optimistic letter (e.g. a `placeLetter` that raced a `gameCompleted` into `GAME_NOT_ONGOING`, or one refused by `ROLE_FORBIDDEN`/`RATE_LIMITED`) would mask the cell's true value forever, since no echo and no gap ever arrive to clear it.
- If several pending entries target one cell, render the most recently sent.
- On a `cellSet` from another user for a cell where you currently render a **non-null** value (sequenced or overlay) that the event changes, whether to a different letter or to `null` (a clear), apply it, and flash the cell in the writer's color for roughly 300 ms. The trigger is a change to *your currently-rendered non-null* value, not the incoming value, so an erase of your letter is never silent (D02); filling a cell you render as empty does not flash. This is the entire conflict UX. Nothing is rejected, and nothing may change silently.
- **Snapshot reconciliation**, used identically for every full snapshot (`welcome`, `sync`, and a crash-rollback snapshot) so the paths cannot drift: clear the overlay, then for each still-pending command, if its `commandId` is in the snapshot's `recentCommandIds` it is confirmed: drop it; otherwise, if the command is still within the recent-command window (K; DESIGN.md section 15), re-add its overlay entry **and re-send it** (MUST after a gap or reconnect, not MAY); if it has aged out of the window, drop it rather than re-send, because re-applying it could regress a value that superseded it. Duplicates are dropped by `commandId`. This stops an overlay entry whose echo was lost in a gap or disconnect from becoming immortal and masking a later write to that cell. Then re-render.
- **Age against K, proposal (not settled).** The rule above re-sends a pending command that is still within the window K and drops it once it has aged out, but it does not fix how a client measures a pending command's age against K. The unit is unspecified: a send-`seq` delta, an applied-command count, or wall-clock time are all candidates. Proposal: measure by `seq` delta, since the server's K counts applied commands and every accepted command consumes exactly one `seq` (section 6). A pending command has aged out when a reconciling snapshot's `board.seq` exceeds the `seq` the client had applied when it sent the command by more than K (a conservative bound, since terminal events also consume `seq`). The client-store vectors (section 13) supply `agedOut` as case input rather than deriving it, so they pin the outcome (aged-out drops, live re-sends) without committing to a measure; until this closes (DESIGN.md section 15, by M2) implementations MUST NOT diverge on the measure.

## 9. Presence, heartbeat, cursors, reactions

- Clients send `heartbeat` every 15 s. The server broadcasts `playerDisconnected` after 45 s with no inbound frame of any type (heartbeat or command), or on socket close; any received frame resets the liveness timer, so an actively typing client never flaps to disconnected.
- `playerConnected` and `playerDisconnected` key on the user's first and last socket, not on each socket. A user is connected while they hold at least one socket, so with several open tabs a second socket announces nothing and closing it disconnects nothing while another socket holds them live; `playerConnected` fires on the 0-to-1 transition and `playerDisconnected` on the 1-to-0. The connecting socket learns the full participant list in its own `welcome`, so it is never sent its own `playerConnected`.
- `moveCursor` at most 10 per second per client; the server MAY drop excess silently.
- On a valid `moveCursor` the server relays a `cursor` notice to the other connections and does not echo it to the sender, which already knows its own cursor. It records the position as that user's current cursor, so the next snapshot's `board.cursors` carries it, and it clears that cursor when the user's last socket closes, so a `playerDisconnected` and the following snapshot agree the departed user has no cursor.
- A `moveCursor` whose `cell` is out of range or a black square is dropped silently, with no error: presence is best-effort, and `INVALID_CELL` (section 11) is a mutation-only mapping. `moveCursor` is role `any` (section 5); a spectator's cursor is suppressed client-side by default, not filtered by the server.
- Presence and cursor state are best-effort: never persisted, never sequenced. The board payload carries the current view at snapshot time.

**Reactions.** `react` is the presence-family sibling of `moveCursor`, and the same best-effort rules govern it.

- `react` is role `any` (section 5), spectators included by design: friends watching a solve get to cheer. `emoji` MUST be exactly one RGI emoji grapheme, matching `/^\p{RGI_Emoji}$/v` (Unicode `RGI_Emoji`, one well-formed emoji) within the existing shape bound of a non-empty string at most 32 UTF-8 bytes, and `cell` is valid iff it is in range and not a black square. Any violation, an `emoji` that is not one RGI emoji grapheme or overruns the byte bound, or an out-of-range or black-square `cell`, is dropped silently with no error, exactly as `moveCursor` is: presence is best-effort, and `INVALID_CELL` (section 11) stays a mutation-only mapping. There is no curated catalog: the gate is this emoji rule, not a membership list, so any emoji is sendable and a user's personal set (section 12) only chooses which five their client offers.
- `react` is rate-limited at most 5 per second per client; the server MAY drop excess silently.
- `react` is legal in any game status, including `completed` and `abandoned`. It mutates nothing, so a terminal state does not gate it the way it gates `placeLetter` (which then draws `GAME_NOT_ONGOING`, section 10); reactions on the finished grid after completion are intended, and the connection already stays open for the post-game screen.
- On a valid `react` the server relays a `reaction` notice to the other connections and does not echo it to the sender, the same fan-out as `cursor`. It is even lighter than a cursor: the server records nothing, so a reaction never appears in a `welcome` or `sync` `board` snapshot (there is no `board.reactions`, unlike `board.cursors`). Pure fan-out, then gone.
- The default reaction set is exactly these five graphemes, in slot order: 🔥 (U+1F525), 🤔 (U+1F914), 🐐 (U+1F410), 💀 (U+1F480), 😭 (U+1F62D). The Phase 7 fixed set (🎉 U+1F389, 🤔 U+1F914, 👀 U+1F440, 💀 U+1F480, 🫡 U+1FAE1) is retired: these five are the default personal set that replaces it. Each user configures their own five, account-synced (section 12, `GET`/`PATCH /me`); a null personal set means these five defaults.
- **Grapheme on the wire; receive-any, send-gated.** The wire carries the emoji grapheme itself, never a symbolic token. The reaction set is server-defined and MAY widen, or later become per-user, WITHOUT a protocol version bump (section 14). A client MUST render or ignore any well-formed `reaction.emoji` it receives, and MUST NOT reject a reaction whose emoji is outside its own send set; only sending is gated by the set. Decoders enforce shape only, a non-empty string of at most 32 UTF-8 bytes, and never set membership, which is session-service policy.
- **Client render guidance (non-normative).** A reaction renders as a transient sticker at its `cell` for roughly 5 seconds, then fades. Repeated sends of the same emoji from one user coalesce client-side rather than stacking sprites. A client binds the `!` and `?` send accelerators to slots 1 and 2 of the sender's personal set (section 12), firing whatever occupies those slots rather than a fixed emoji (by default 🔥 and 🤔). A handful of the longest multi-person ZWJ sequences exceed the 32-UTF-8-byte shape bound and so are not sendable; widening the bound later is additive (section 14).

## 10. Completion and check

- The server tracks `filledCount`. After every accepted mutation, while `filledCount` equals the playable-cell count (including a same-value or corrective overwrite that does not change the count), the server MUST validate the whole board against the solution. The check is level-triggered, not edge-triggered: it MUST re-run on a same-count overwrite, so a full-but-wrong board corrected in place still completes. Pass: exactly one `gameCompleted`, persisted before broadcast. Fail: nothing is emitted; play continues.
- After `gameCompleted` or `gameAbandoned`: `placeLetter`, `clearCell`, and `checkPuzzle` receive `GAME_NOT_ONGOING`. The connection stays open for the post-game screen. A terminal state is final: a second `abandon`, or a late completion attempt, is a no-op (INV-4).

**Room check.** The check is a deliberate, room-wide act: one command marks every incorrect entry for everyone, without revealing answers. There is no private check.

- `checkPuzzle` is legal only while the game is ongoing and the grid is full (`filledCount` equals the playable-cell count); otherwise `GAME_NOT_ONGOING` or `GRID_NOT_FULL` (section 5). Because completion is level-triggered, a full and correct board is never ongoing, so an accepted check always finds at least one wrong cell.
- An accepted `checkPuzzle` consumes a `seq` and broadcasts one `puzzleChecked` (section 6) carrying `wrongCells`, every cell whose value fails the comparator, ascending. The event replaces any standing marks wholesale and increments the permanent `checkCount`.
- A mark stands until the cell's **value changes**: a `cellSet` that sets a different letter, or clears to null, removes that cell's mark; a same-value no-op keeps it, because the mark is still true. This is reducer semantics, identical in both ports and pinned by the `check` vectors (section 13).
- At completion no mark stands: every marked cell was wrong, and passing the comparator required its value to change, which cleared the mark. Pinned by vectors.
- `checkCount` is permanent, neutral state: it never resets, it survives passivation in the snapshot, it freezes into `stats.checkCount` at completion, and nothing on the wire attributes any check to a user (section 6). Future scoring surfaces may tax it; nothing displays who checked.
- Client guidance, non-normative: a check affects the whole room, so a client SHOULD interpose a confirmation step before sending `checkPuzzle`; the command is the confirmed intent and the server needs no ceremony. Render `checkedWrongCells` in the check style; a cell with a pending optimistic overlay entry renders the overlay, not the mark.
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
| `GRID_NOT_FULL`                | no     | `checkPuzzle` while a playable cell is empty             |
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
| `POST /puzzles`                       | full account                            | ingest a puzzle document: a bare XWord Info JSON body (the legacy form), or the multi-format envelope `{format, document}` (below); returns the puzzle view (`201`), a duplicate-of-the-caller's-own view (`200` with `duplicate: true`; D23, below), or a named rejection (barred, diagramless, uniclue, over 25x25, degenerate/zero playable cells, unsolvable/non-enterable solution cell) |
| `GET /puzzles`                        | authenticated (own uploads)             | the caller's uploaded puzzles, newest first; per puzzle `{puzzleId, createdAt, rows, cols, features, title, author, mask}` (`title`/`author` are display metadata, null when absent; `mask` is the black-square silhouette, pattern only), no solution (INV-6); `limit` (default 50, max 100) + `createdAt`-cursor `before` pagination |
| `POST /games`                         | full account                            | `{puzzleId, name?}` creates a game; `name` is an optional display label (trimmed, capped at 80 chars, absent/empty is unnamed); returns the game, its invite code, and the `name` |
| `GET /games`                          | any authenticated user, guests included | the caller's games (membership join), most-recently-active first within the page; per game `{gameId, name, role, createdAt, createdBy, memberCount, members, inviteCode, completedAt, abandonedAt, lastActivityAt, puzzle:{puzzleId, rows, cols, title, mask}}` (`puzzle.title` is display metadata, null when absent; `puzzle.mask` is the black-square silhouette, pattern only; `members` is the full membership as display identity, `inviteCode` the same member-only code the game view returns, both defined below; `completedAt` is the ISO completion time, null while ongoing and null for an abandoned game; `abandonedAt` is the ISO time a host ended the game, null unless it was abandoned; the two terminal timestamps are mutually exclusive, so a game reads as exactly one of ongoing (both null), completed (`completedAt` set), or ended (`abandonedAt` set), and a client shelves it on that; `lastActivityAt` is the ISO time of the game's newest board event, null for a game no one has played yet), no board (game_state is session-owned, DESIGN.md section 9); `limit` (default 50, max 100) + `createdAt`-cursor `before` pagination, with a server-computed `nextBefore` on the response |
| `POST /games/{id}/join`               | any authenticated user, guests included | `{code}` creates membership: a new full account seats `solver` (play at once), a guest `spectator` (owner decision 2026-07-10); a non-demoting upsert, so an existing member keeps their role |
| `POST /games/join`                    | any authenticated user, guests included | `{code}` resolves the game by invite code alone (no `gameId`) and joins with the same seating as `/{id}/join` (full account `solver`, guest `spectator`); returns `{gameId, role, userId}` (the resolved `gameId` lets a code-only caller open the view and WS); a code matching no game is `GAME_NOT_FOUND` |
| `POST /games/{id}/role`               | full-account member                     | self-upgrade `spectator` to `solver`; a guest is refused `FULL_ACCOUNT_REQUIRED` (joining as a solver requires a named account, DESIGN.md section 8) |
| `DELETE /games/{id}/members/{userId}` | host                                    | kick: removes membership, writes the denylist, disconnects live sockets; the host MUST NOT target themselves (`403`) |
| `POST /games/{id}/abandon`            | host                                    | terminal state, executed via the session service                                                                               |
| `DELETE /account`                     | authenticated (self)                    | tombstone the caller's own account: scrub PII, keep the id, run host succession or auto-abandon per hosted game (DESIGN.md section 8) |
| `GET /me`                             | authenticated (self)                    | the caller's display identity `{userId, displayName, isAnonymous, avatarUrl, needsName, reactionSet}`; `displayName` is the app-DB value and MAY be null (the only place null crosses, so a client can detect a nameless account and onboard); `needsName` is the server-computed onboarding trigger `!isAnonymous && displayName === null` (the client holds no naming policy); `reactionSet` is the caller's five reaction emoji in slot order as a string array, or null for the default five (section 9); works with zero games |
| `PATCH /me`                           | authenticated (self)                    | `{displayName?, reactionSet?}` updates the caller's profile; `displayName` the server NFC-normalizes, trims, collapses internal whitespace, validates (1-40 graphemes, no control/zero-width/bidi-override, INV-1 casing does NOT apply); `reactionSet` is null (reset to the default five) or an array of exactly five distinct entries, each one RGI emoji grapheme within 32 UTF-8 bytes (the section 9 send-gate rule); returns the canonical `{userId, displayName, isAnonymous, avatarUrl, needsName, reactionSet}`; rejects `NAME_REQUIRED`/`NAME_TOO_LONG`/`NAME_INVALID` and `REACTION_SET_LENGTH`/`REACTION_SET_INVALID`/`REACTION_SET_DUPLICATE` (422), a malformed body `VALIDATION` (400); rate-limited per user |
| `GET /games/{id}`                     | member                                  | the game view: solution-stripped puzzle, membership (each member `{userId, role, joinedAt, avatarUrl}`, `avatarUrl` the same opaque nullable field as section 4), session endpoint, the optional `name`, and the `inviteCode` (members only, any role: every member joined via it) |
| `GET /games/{id}/analysis`            | member, completed game only             | the post-game analysis bundle: `{owners: {[cell]: userId}, momentum: {durationSeconds, samples[40]}, moments: {firstToFall, lastSquare, turningPoint}, sequence: [{cell, atSeconds}], titles: [{userId, title, evidence}]}`, the whole completed surface in one fetch. `owners` is the first-correct map (who FIRST placed the correct value in each cell); `momentum` is the room's tempo (a 40-sample peak-normalized ribbon plus the solve's duration); `moments` are three named beats from timing alone (the opening, the closing, the turning point), each nullable; `sequence` is the ordered `{cell, atSeconds}[]`, ascending by `(at, seq)`, each cell and the relative second it first went correct, for the post-game solve replay (another projection of the same trace, no userId, the owner comes from `owners`); `titles` is the solver superlatives, ordered by ladder rank, at most one per solver and one per key (`title` a lowercase-kebab key from the pinned ladder, `evidence` the title's own count or null; a client MUST ignore an unknown key, which is how the ladder grows without client lockstep; empty when fewer than two solvers wrote, regardless of member count; `design/post-game/TITLES.md` pins the stat sheet, the gates, and the ladder). The Archive read model, computed on read from `cell_events` (now also selecting `at`, DESIGN.md section 7, section 9). userIds, cells, and numbers only, no solution content (INV-6); the client already holds the roster from the game view. This MUST stay off the `GET /games` list path, which keeps its cheap `MAX(at)` aggregate; this is a per-game, on-demand read. Gated to completed games (an ongoing game's trace leaks solving progress; an abandoned-game recap is deferred): a game that is not completed is `GAME_NOT_FOUND`, and a non-member is `NOT_PARTICIPANT`, the same gate as the game view. Replaces the unshipped `/attribution` |
| `GET /{code}` (invite host)           | public                                  | the short invite link `{invite-host}/{code}`: an OpenGraph shell for unfurlers, a `302` to the game view for a browser; iOS claims it as a universal link (prose below)                              |
| `GET /g/{code}`                       | public                                  | legacy invite unfurl: an HTML shell with OpenGraph tags for link unfurlers                                                                              |

Puzzle views are typed `ClientPuzzle`, a type with no solution field, including none embedded in clue structures, so stripping is structural, not runtime (DESIGN.md INV-6).

**Clue markup (`runs`).** Vendor clues carry inline markup: an italicized cited work, a subscript in a formula, a bolded word. Crossy renders this as structured runs, never as raw HTML on the wire and never by stripping the markup away. A `Clue` therefore gains one optional additive field, `runs`, alongside its existing `text`:

```json
{
  "number": 17,
  "text": "See Rocky for one",
  "cellIndices": [34, 35, 36],
  "runs": [
    { "t": "See " },
    { "t": "Rocky", "s": ["i"] },
    { "t": " for one" }
  ]
}
```

A `run` is `{ "t": string, "s"?: Style[] }`, where `Style` is one of `"i"`, `"b"`, `"sub"`, `"sup"`. `text` stays the canonical plain projection, and `runs` is the same clue re-expressed as an ordered list of styled spans. The projection and the runs are derived from the vendor string at ingestion (DESIGN.md section 7), pinned by the conformance vectors (section 13, `clue-runs`), and normalized by these laws:

1. **Plain projection.** The concatenation of every run's `t`, in order, equals `text` exactly. A client that ignores `runs` and renders `text` shows the same characters a run-aware client shows unstyled.
2. **Omitted when unstyled.** `runs` is absent from the clue entirely when the whole clue is plain. It is never an all-plain `runs` array standing in for its own `text`.
3. **Minimal runs.** No run has an empty `t`. `s` is omitted rather than present-and-empty, and lists no duplicate style.
4. **Fixed style order.** Styles inside one `s` are ordered `"b"`, `"i"`, `"sub"`, `"sup"`, so a style set has exactly one serialization.
5. **Adjacent merge.** Adjacent runs with identical style sets are merged, so the run list is the shortest that expresses the styling.
6. **Normalized text.** `text` is the plain string after markup is parsed out, entities are decoded, Unicode whitespace is collapsed to single ASCII spaces, and the result is trimmed.
7. **Vocabulary.** `<i>` and `<em>` map to `"i"`; `<b>` and `<strong>` to `"b"`; `<sub>` to `"sub"`; `<sup>` to `"sup"`. Tag names match case-insensitively (ASCII-only, INV-1). Any other tag contributes no style, but its text content is kept. A `<br>` in any form (`<br>`, `<br/>`, `<BR>`) becomes a single space.
8. **Parse before decode.** Tags are recognized on the raw string before entities are decoded. An entity-escaped tag such as `&lt;i&gt;` is therefore literal visible text, never formatting, and a literal `3 < 4` is preserved (the `<` is not a tag start, so nothing is consumed).
9. **Nesting flattens.** Nested markup flattens to a style set: `<b><i>x</i></b>` yields one run with `s` `["b", "i"]`.
10. **Whitespace on the projection.** Whitespace collapse operates on the projection, across run boundaries. A collapsed run of whitespace carries the styles of its first whitespace character. A run left empty by collapse or by the outer trim is dropped (which can, by law 2, drop `runs` entirely if what remains is plain).
11. **Literals pass through.** Every literal character survives untouched, notably the leading `*` of the starred-clue convention (`*Like this clue's answer`).
12. **Malformed markup is forgiving and deterministic.** An unclosed whitelist tag styles through the end of the string. A stray closing tag with no matching opener is dropped. These are the only two malformed shapes, and both are pinned by vectors so the two ports cannot diverge.

The field is additive and follows expand/contract (section 14): it bumps no version. A client without `runs` support renders `text`, which remains the canonical plain projection (law 1), so it loses only the styling, never a character. A client MUST NOT parse markup out of `text`: `text` is already plain by law 6, and any markup a clue carries is expressed only through `runs`. `runs` carries no solution content (it restyles the same clue text, INV-6 untouched), so it lives on the shared clue shape and crosses to the client on `ClientPuzzle` like the rest of the clue.

The two list endpoints (`GET /games`, `GET /puzzles`) back the signed-in home. Both are cursor-paginated, never offset: a `limit` clamped to `[1, 100]` (default 50) and an optional `before`, an ISO 8601 `createdAt` the page filters strictly before (`created_at < before`). A present but unparseable `before` is `VALIDATION` (400). Both carry only INV-6-safe puzzle geometry (rows, cols) projected server-side, never the solution-bearing snapshot. Visibility is scoped to the caller: `GET /games` returns only games the caller is a member of (any role, guests included), and `GET /puzzles` returns only puzzles the caller uploaded. `GET /games` reports completion through `completedAt`, the ISO time a game finished, null while it is ongoing and null for an abandoned game (which never completed, so it never stamped a completion time). `completedAt` is read from the session-owned `game_state.completed_at` under the core API's SELECT-only read grant on `game_state` (the planned read expand, DESIGN.md section 9); the grant is read only, so single-writer holds (INV-7 governs writes, not reads), and the API selects only that terminal timestamp, never the board. A game whose `game_state` row does not exist yet (created but never connected, so the actor has not materialized it) reads as ongoing, `completedAt` null, via a left join. A full lifecycle `status` enum (ongoing, completed, abandoned) that also distinguishes abandonment remains a later additive extension, landing with the Archive module's broader read models; `completedAt` is the one lifecycle fact the home needs today, and it never carries a solution (it is a bare timestamp, INV-6 untouched).

**Activity ordering and the pagination contract (`GET /games`).** The home wants its rooms in the order people last touched them, not the order they were created. `GET /games` therefore carries `lastActivityAt`, the ISO time of a game's newest board event, and orders each returned page by when the game was last touched, most recent first. The sort key is `COALESCE(lastActivityAt, createdAt)`: creating a room is its first activity, so a freshly created game with no events yet sorts by its `createdAt`, right where a room played at that same instant would sit (at the top of a fresh page, not banished below every played game). `lastActivityAt` is `MAX(cell_events.at)` for the game, read from the session-owned event log under the core API's SELECT-only read grant on `cell_events` (migration 0008, the next step of the planned read expand DESIGN.md section 9 records); the grant is read only, so single-writer holds (INV-7 governs writes, not reads), and the API selects only the aggregated timestamp, never a cell `value` or the board, so no solution content leaves the server (a bare `MAX(at)` is INV-6-safe, the same shape as the `completedAt` read). `lastActivityAt` still comes back null on the wire for a game with no events yet (the shape does not change, so a client can still tell "active X ago" from "started X ago"); only the ordering coalesces it to `createdAt`. Two games that share a coalesced key break the tie by `createdAt` descending, then `gameId`, so the order is total and deterministic.

Pagination stays anchored to `createdAt`, and this is deliberate: `lastActivityAt` moves as people play, so ordering the whole paginated set by it would let a game jump between pages between two requests and be seen twice or missed. Instead the page is *selected* by the stable `createdAt` DESC cursor exactly as before (the `before` filter is still `created_at < before`, so a row never shifts pages as activity changes), and then the rows of that page, and only that page, are *reordered* by the display key `COALESCE(lastActivityAt, createdAt)` DESC. The honest consequence: an old game with fresh activity rises to the top of its own page but does not jump to page 1. This is the right trade for the signed-in home, which reads only the first page (default limit 50): that bounded set of recents is fully activity-ordered, which is what the home shows, while deep pagination below the fold stays stable and skip-free on `createdAt`.

Because the page is selected by `createdAt` but shown by the coalesced activity key, the visible last row is no longer the page's oldest `createdAt`, so "page by the last row's `createdAt`" no longer holds. `GET /games` therefore returns a server-computed `nextBefore` alongside `games`: the minimum `createdAt` of the page (the correct next cursor under the selection order), or null when the page did not fill to `limit` (the list is exhausted, so there is no next page). A client MUST page by passing this `nextBefore` as the next `before`, never by re-deriving a cursor from the reordered rows. `GET /puzzles` is unaffected: it has no activity dimension, so its rows stay `createdAt` DESC and the last row's `createdAt` remains a valid cursor (a `nextBefore` may be added there later for symmetry; it is not required today).

Both list rows carry the puzzle's `mask`: its black-square silhouette, the pattern only. A `mask` is an array of `rows` strings, each exactly `cols` characters long, where `#` is a black square and `.` is a playable cell. It is derived server-side from the stored puzzle's geometry and block positions (`rows`, `cols`, and the block indices), which the two list endpoints already project without ever selecting the solution-bearing snapshot whole. The mask carries the pattern and nothing else: no letters, no clue numbers, no circles, no solution content of any kind, so INV-6 holds (the silhouette is the same public geometry the OpenGraph preview may show, DESIGN.md section 7, `/og/{gameId}` "geometry only, never fills"). It is the face of the puzzle, the one strong object the signed-in home renders per room and per upload. The reader indexes it row-major like the board (row `r`, column `c` is character `c` of string `r`, cell index `r * cols + c`), so a client can paint it directly. A puzzle stored without materialized geometry is impossible (ingestion always produces `rows`, `cols`, and blocks, DESIGN.md section 7), so `mask` is always present and never null on either list.

The game `name` is optional user content shown back verbatim. It is never normalized or compared, so the ASCII-only casing rule (INV-1) does not apply to it; it is trimmed and capped at 80 characters on write, and absent, null, or empty all read as unnamed. The `inviteCode` on the game view, and on each `GET /games` row (below), is returned only to a member (any role, spectators included, since every member joined via it) and never to a non-member or an unauthenticated caller; it is the same capability code as `POST /games/{id}/join`.

`POST /games/join` joins by the invite code alone, for a caller who holds only the code (a hand-typed or read-aloud code, no `gameId`; web invite links carry both). It resolves the game by its unique invite code and then seats the caller with the exact semantics of `POST /games/{id}/join`: denylist checked first (a kicked user is refused `DENIED`), then an idempotent, non-demoting seat that lands a new full account as `solver` and a guest as `spectator` (owner decision 2026-07-10), guests allowed. The lookup is normalized ASCII-only (INV-1): the invite alphabet is all uppercase ASCII, so a lowercase code resolves iff uppercased, with no locale folding. A code matching no game is `GAME_NOT_FOUND` (the code is the lookup key, so there is no game existence to protect, unlike the id-based join where a wrong code is `DENIED`). The response repeats `/{id}/join`'s `{gameId, role, userId}`; `gameId` is the one value the caller lacked.

**Invite links.** The shareable invite link is short: `https://{invite-host}/{code}`, carrying only the invite code (the join capability), no `gameId` and no name. This is the canonical form every client emits for sharing (copy, QR, system share); the code alphabet is ASCII-only and CHECK-constrained (`^[2-9A-HJ-NP-Z]{8}$`), so a rendered link cannot carry markup or raw caller input. The invite host serves two audiences from `GET /{code}`: a link unfurler receives a static OpenGraph shell (generic copy, never board state or a solution, DESIGN.md section 7), and a browser is redirected (`302`) to the canonical game view `{web-origin}/game/{gameId}?code={code}`, where the signed-out gate and the existing join flow take over. The redirect resolves the code to its `gameId` by the same normalized ASCII-only lookup as `POST /games/join` (INV-1); a code matching no game lands on the web home, not an oracle `404`, and the redirect exposes no `gameId` the long link did not already carry, since the code is the capability. On iOS the invite host is an associated domain, so an installed app opens `{invite-host}/{code}` directly as a universal link, bypassing the web fallback; the app and every scanner accept a code from any recognized form (a bare code, a link with `?code=`, the legacy `/g/{code}`, and this short `{host}/{code}`), each normalized ASCII-only (INV-1). Older links keep resolving unchanged: `/game/{id}?code=` renders the game directly, and `/g/{code}` stays the legacy unfurl. The short form is additive and bumps no version (section 14).

**Display name (`GET /me`, `PATCH /me`).** Every account carries a non-null display name once onboarded. `GET /me` is the self-identity read that works before any game exists (an onboarding surface runs before a first join); it returns the raw app-DB `display_name`, which may be null for an account that has not chosen one yet, so a client can detect the nameless state and prompt. The server computes the trigger for the client: `GET /me` carries `needsName`, `!isAnonymous && displayName === null`, so the naming policy lives in one place (the identity service) and the client holds none. `PATCH /me` is the single write path for the name (the JIT mirror only fills a name it is given and never overwrites a chosen one, so an edit cannot ride the mirror). The name is user content shown back verbatim: it is never uppercased or folded (INV-1 casing is cell-values only), and it carries no solution content (INV-6 untouched). The server canonicalizes (Unicode NFC, trim, collapse internal whitespace) and validates (1 to 40 grapheme clusters; rejects control characters, lone zero-width formatters, and bidi overrides; allows every other letter, mark, number, symbol, and emoji, so Unicode names like a cedilla-bearing given name or a Han name are preserved); it enforces no uniqueness. A well-formed body whose name violates a rule returns a named 422 (`NAME_REQUIRED`, `NAME_TOO_LONG`, `NAME_INVALID`); a malformed body (missing field, wrong type) is 400 `VALIDATION`. The write is idempotent on the canonical value and rate-limited per user. Both routes are additive and bump no version (section 14). The wire display name in section 4 stays non-null: the session substitutes `"former participant"` only for a tombstoned account whose name was scrubbed (DESIGN.md section 8), a case onboarding does not touch.

**Reaction set (`GET /me`, `PATCH /me`).** Every account carries a personal reaction set, the five emoji its client offers to send (section 9). `GET /me` returns `reactionSet`, either an array of five graphemes in slot order or null; null means the default five (section 9) and is the state of every account until it chooses otherwise, so a client with no stored preference renders the defaults without a write, and a fresh guest reads null like any account. `PATCH /me` is the single write path: `reactionSet` accepts null, which resets to the defaults, or an array of exactly five entries, each exactly one RGI emoji grapheme within the section 9 shape bound (matches `/^\p{RGI_Emoji}$/v`, at most 32 UTF-8 bytes), and all five distinct. There is no curated catalog: any emoji may fill a slot, the same posture the send gate takes (section 9). The set is account-synced, not device-local, so it follows a user across web and iOS, and it works for a guest, whose durable `users` row (the JIT upsert, DESIGN.md section 8) holds the column like any account's. Distinctness compares the exact grapheme strings: two entries that render alike but differ in code points (a variation selector, a skin-tone modifier) are distinct. A malformed body (wrong type, not an array of strings) is 400 `VALIDATION`; a well-formed body whose set violates a rule returns a named 422 in the style of the `NAME_*` codes, `REACTION_SET_LENGTH` (not exactly five), `REACTION_SET_INVALID` (an entry is not one RGI emoji grapheme within the bound), or `REACTION_SET_DUPLICATE` (a repeated entry). The API is the single writer of `users` (INV-7), so the set lives in one column it owns; the session service never reads it, since a `react` carries the grapheme itself (section 9). Both routes are additive and bump no version (section 14).

The puzzle `title` and `author` are display metadata parsed from the uploaded document at ingestion. They are shown back verbatim and are never normalized or compared, so INV-1 casing does not apply, and they are not solutions, so INV-6 is untouched; ingestion entity-decodes, trims, and caps each at 200 characters, and absent, null, empty, or non-string all read as null. They live on the `puzzles` row (not on `ClientPuzzle`/`ServerPuzzle`, which the solve screen does not need), so they surface only on the two list rows above: `title` and `author` on `GET /puzzles`, and `title` in the `puzzle` summary on `GET /games`.

The member `avatarUrl` is resolved server-side, exactly once, at the same place the display name is (the identity mirror, DESIGN.md section 8): the OAuth identity's avatar from provider metadata when present, else a Gravatar URL derived from the account email, else `null`. It snapshots onto the same API-owned `users` row under the same single writer (INV-7), so the WebSocket participant payload (section 4) and this REST listing read one resolved value and cannot drift. The email is used only to compute the Gravatar hash server-side and never leaves the server, in this listing or any payload (INV-6 spirit); no client sees or can derive it. `avatarUrl` is opaque and nullable, rendered per section 4's fallback rule.

**The row member stack (`GET /games`).** Each row carries `members`, the game's full membership as display identity: per member `{userId, name, avatarUrl, role}`, ordered by join time ascending (the first joiner leads) with ties broken by `userId`, so the order is total and deterministic. This is what lets a client open a room's chrome true at the instant a card is tapped, and paint an identity-true avatar stack on the card, without a second fetch. `name` is the section 4 display name, resolved once at the identity mirror (DESIGN.md section 8) and never null on the wire: where the mirror holds no name the server sends the same "former participant" the session's participant payload sends, so this listing and the live roster read one value and cannot drift. `avatarUrl` is the same opaque nullable field as section 4, rendered per its fallback rule; never an email or anything derived client-side (INV-6 spirit, the paragraph above). `role` is each member's seat, so a client can apply the standing solvers-only display filters; a guest seats `spectator` (the join rules above) and there is no guest flag on the wire. `memberCount` stays on the row as the same total (all roles), and on a current server it equals `members.length`. Each row also carries the game's `inviteCode` under exactly the game view's visibility rule: members only, any role, since every member joined via it. The list is member-scoped by construction (a caller receives only games they belong to), so a row structurally cannot hand the code to a non-member, and the field travels no wider than `GET /games/{id}` already sends it. Both fields are additive (section 14): an older server omits them, and a client reads an absent `members` as empty and an absent `inviteCode` as none.

Unlike every WebSocket message in this document, the puzzle payload carries no literal example here, by design: it is a REST payload owned by ingestion (DESIGN.md section 7), and its full schema (image clues, cross-references, per-cell numbering) is ingestion's to pin. A literal `ClientPuzzle`/`ServerPuzzle` example and its serialization golden land with the ingestion slice (DESIGN.md section 7), not in this document; the load-bearing fact here is only the solution split (INV-6).

**REST error vocabulary.** These codes are the API's own contract (`apps/api/src/http/errors.ts`), listed here so this document reads standalone. Every REST failure returns a small JSON body `{ error, message }` plus the matching HTTP status, so a client keys on a stable string, never on prose. The surface reuses the section 11 names that carry the same meaning across the wire and adds the REST-only codes it needs:

| code                    | HTTP | meaning                                                        |
| ----------------------- | ---- | ------------------------------------------------------------- |
| `UNAUTHORIZED`          | 401  | bad or missing bearer token                                   |
| `FULL_ACCOUNT_REQUIRED` | 403  | a guest attempted a create action, or a guest tried to upgrade to solver (DESIGN.md section 8) |
| `NOT_PARTICIPANT`       | 403  | authenticated, but not a member of this game                  |
| `DENIED`                | 403  | on the game's denylist, or a wrong invite code                |
| `FORBIDDEN`             | 403  | a member, but not permitted this action: a non-host kick or abandon, or a host targeting themselves in a kick |
| `GAME_NOT_FOUND`        | 404  | unknown `gameId`                                              |
| `PUZZLE_NOT_FOUND`      | 404  | unknown `puzzleId`                                            |
| `VALIDATION`            | 400  | malformed or missing request body                             |
| `NAME_REQUIRED`         | 422  | `PATCH /me`: the display name is empty after canonicalization (whitespace-only or all-stripped) |
| `NAME_TOO_LONG`         | 422  | `PATCH /me`: the display name is over 40 grapheme clusters after canonicalization              |
| `NAME_INVALID`          | 422  | `PATCH /me`: the display name has a disallowed character (control, lone zero-width, or bidi override) |
| `REACTION_SET_LENGTH`   | 422  | `PATCH /me`: `reactionSet` is not exactly five entries                                          |
| `REACTION_SET_INVALID`  | 422  | `PATCH /me`: a `reactionSet` entry is not one RGI emoji grapheme within 32 UTF-8 bytes (section 9) |
| `REACTION_SET_DUPLICATE`| 422  | `PATCH /me`: `reactionSet` has a repeated entry (distinctness compares the exact grapheme string) |
| `INTERNAL`              | 500  | a server fault, such as a required downstream call failing (the session notify an abandon depends on) |

Puzzle ingestion (`POST /puzzles`) rejects an unacceptable puzzle with a named reason, so the user reads why (DESIGN.md section 7). The status split is pinned to what the ACL ships (`apps/api/src/http/errors.ts`, `apps/api/src/puzzles/ingest.ts`): a body that is not a well-formed XWord Info document is `VALIDATION` (400); a document that parses but describes an unacceptable puzzle is one of the named rejections below, each `422`, because the puzzle is well-formed but violates a domain rule the user can read and act on. The named ingestion rejections, from the SP5 corpus study (`reports/spikes/sp5-puzzle-corpus.md`) and the shipped ACL:

| code                 | HTTP | meaning                                                                                                                                                        |
| -------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNSOLVABLE_CELL`    | 422  | a solution cell no legal input can satisfy: ASCII-uppercased it is non-empty, its first character is not in `A-Z0-9`, and the whole string fails `^[A-Z0-9]{1,10}$` (a whole-cell symbol such as `/` or `+`) |
| `REBUS_TOO_LONG`     | 422  | a cell whose canonical solution exceeds 10 characters; a named rejection, never a silent truncation                                                             |
| `OVERSIZE_GRID`      | 422  | a grid past the 25x25 cap, with both dimensions checked independently since real grids are non-square and may be even-dimensioned                               |
| `AMBIGUOUS_SOLUTION` | 422  | a Schrodinger or multi-clue-per-slot puzzle the one-solution-per-cell model cannot represent                                                                    |
| `DEGENERATE_GRID`    | 422  | zero playable cells, which would make completion vacuous or unreachable (DESIGN.md section 7)                                                                    |
| `DIAGRAMLESS`        | 422  | a diagramless puzzle, a known-incompatible flag v4 does not support (DESIGN.md section 7, D13)                                                                   |

Barred and uniclue puzzles (section 12 table; DESIGN.md section 7) belong to the same reason-per-rejection contract but ship no code: SP5 records no JSON field or flag that identifies either, so there is nothing to trigger on (DESIGN.md section 15). Asymmetric grids and unchecked cells are valid puzzles and are never rejected (SP5).

**Multi-format ingestion (the `{format, document}` envelope).** Lands with the extension-ingest wave (ROADMAP Phase 6; DESIGN.md section 7, D21). `POST /puzzles` accepts a second body form, an envelope `{format, document}`: `format` names a registry entry below, and `document` is the raw outlet payload exactly as extracted from a page the user had open, untransformed (the extension is deliberately dumb; DESIGN.md section 7). Dispatch is deterministic and never guesses: a JSON object carrying both a string `format` and a `document` key is the envelope; a body without a `format` key is a bare XWord Info document (the legacy form, equivalent to `format: "xwordinfo"`); a body with `format` but no `document`, or a non-string `format`, is `VALIDATION`.

| format      | document                                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `xwordinfo` | object: the XWord Info JSON export (the same document the legacy bare body carries)                              |
| `nyt`       | object: the NYT v6 puzzle JSON as present in the nytimes.com puzzle page                                          |
| `guardian`  | object: the Guardian crossword JSON embedded in its puzzle page                                                   |
| `amuselabs` | string: the encoded AmuseLabs (PuzzleMe) blob as found in the page; decoding is translation and happens server-side, in the ACL |

Every translator lands on the same internal `ServerPuzzle` and the same domain checks, so the named rejections above apply to every format uniformly and the response shape (the `ClientPuzzle` view, INV-6) does not vary by format. Two codes join the REST vocabulary with this envelope:

| code               | HTTP | meaning                                                                                                                                                       |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNKNOWN_FORMAT`   | 400  | the envelope names a format not in the registry (typically an extension newer than the server); the message names the format and never echoes the document      |
| `SOLUTION_MISSING` | 422  | the document is well-formed but carries no complete solution grid (for example a Guardian payload with `solutionAvailable: false`); v1 requires solutions at ingest so server-side check and completion work unchanged (D11, INV-6) |

Registry names are stable identifiers, never parsed for meaning; outlet format drift is absorbed inside the named translator, so the external format is still parsed exactly once, at the boundary (DESIGN.md section 7, D13). The registry is open-ended: a future format (for example binary `.puz`, carried base64 in `document`) joins by adding a translator, a name, and its fixtures, never by widening an existing translator.

**Duplicate ingest is idempotent (DESIGN.md D23).** The extension re-posts the same daily puzzle routinely, so `POST /puzzles` is idempotent per account on the puzzle's content: a re-post of a puzzle the caller already uploaded resolves to the existing row rather than creating a copy. The server computes a per-account content digest over the whole puzzle (geometry, circles, solution, and normalized plain clue text; server-side only, never on the wire, INV-6; DESIGN.md section 7). The two outcomes are distinguished only by HTTP status and one additive field:

- **New puzzle:** `201`, body `{ puzzleId, puzzle }` (the `PuzzleView`, `ClientPuzzle`). The `duplicate` field is absent, which reads as `false`.
- **Duplicate:** `200`, body `{ puzzleId, puzzle, duplicate: true }`, where `puzzleId` and `puzzle` are the caller's existing row for this content. The caller always leaves with a usable `puzzleId`.

`duplicate` is an additive optional boolean; a client that ignores it loses nothing (it still has the `puzzleId`), which is why the extension can treat `200` and `201` identically and the web upload surface can key its "you already have this one" affordance on the field. The digest itself never appears in the response or any other payload: it is solution-derived, so surfacing it would leak a solution oracle (INV-6). Dedup is scoped to the caller (`created_by`), so a `200` reveals only that *you* already added this puzzle, never that another account holds it. A `409` is deliberately not used: dedup is not an error, and forcing a conflict status would make both clients special-case a non-failure and re-parse the body for the existing id. This idempotency is orthogonal to the named rejections above: a duplicate is only ever detected after the document has translated and passed every domain check, so an unacceptable puzzle still returns its `422`/`400` rejection, never a `200`.

## 12a. Live Activity push

The iOS app starts a Live Activity locally when it backgrounds an ongoing room. The server keeps that activity current by pushing a new content-state to it over APNs, and ends it when the game reaches a terminal state. This is a server-to-device push channel, separate from the gameplay WebSocket (which carries only the live session) and from the REST core (which owns everything else). The two REST endpoints below register and unregister the per-activity update tokens the push channel needs.

### Content-state payload

One JSON object rides inside the standard APNs Live Activity envelope as `aps.content-state`:

```json
{
  "pucks": [
    {
      "initial": "E",
      "red": 214,
      "green": 178,
      "blue": 92,
      "connected": true,
      "userId": "a1b2c3d4-0001-4a1a-8b2b-000000000001"
    }
  ],
  "filled": 34,
  "total": 78,
  "status": "ongoing",
  "completedAt": null
}
```

- `pucks`: the live roster cluster, at most 4, in presence order. Each puck is render-ready for the island's dark ground: `initial` is a single ASCII-uppercased letter (INV-1), `red`/`green`/`blue` are 8-bit sRGB components (0 to 255) resolved server-side, and `connected` drives away-dimming. The cluster rides the content-state, not the activity's immutable attributes, so a member who joins after the activity started still appears.
- `userId`: optional. The member's opaque user id, the same value the section 4 participant payload carries. The client keys its locally cached avatar art off it. It is null or absent when unknown, and reveals nothing toward the solution (INV-6).
- `filled` / `total`: fill progress as counts. Counts only: no letters, no cell coordinates, nothing derivable toward the solution (INV-6). The lock-screen surface shows how full the grid is, never what fills it.
- `status`: `ongoing`, `completed`, or `abandoned`, mirroring section 4.
- `completedAt`: an ISO 8601 UTC timestamp, set exactly when `status` is `completed`, and null otherwise. An abandoned game never completed, so it carries null.

### APNs envelope and lifecycle

The payload travels inside the standard ActivityKit envelope. An update carries `aps.event: "update"`, a server `aps.timestamp`, and the content-state above under `aps.content-state`.

A terminal state ends the activity, but the two outcomes are not shipped the same way, because done is an event. A completed game announces itself. It ships first as an alerting update: `aps.event: "update"` carrying the final content-state and an `aps.alert` dictionary (`title`, `body`, `sound`), the shape ActivityKit uses to break through, so the system auto-expands the island and lights a dark lock screen. The `title` is a fixed line and the `body` names the room. A short beat later, once the announcement has had its moment, the `end` event follows: `aps.event: "end"` with the same final content-state and a `dismissal-date`, so the last frame is the terminal one and the island then retires. An abandoned game is quiet. It ships as a single `end` event, `aps.event: "end"` with the final content-state and a `dismissal-date`, no alert. The asymmetry is deliberate: an abandonment is not a celebration.

Registration triggers a welcome frame. The moment a member's update token registers, the server sends one authoritative `update` to that member's own tokens, so the freshly backgrounded island shows live server state at once rather than waiting out the debounce window. The welcome carries the current content-state and bypasses the per-game dedupe, since a fresh token has received nothing yet. It also closes a race: a member's own disconnect push can fire before their token lands and be dropped, and the welcome re-delivers current truth once the token exists. Fill updates are leading-edge debounced: a fill after a quiet window pushes immediately at low priority and re-arms the window, while fills inside the window coalesce and flush once as the latest state when the window opens. A content-state identical to the last one sent still never pushes.

The clock is computed on device, never pushed. The activity's immutable attributes carry the room's `firstFillAt` as the anchor, and the widget derives elapsed time from its own clock at each render; under an hour a native system timer ticks the seconds with zero pushes. The clock's register coarsens with the room's age: seconds tick to the hour, an hour to a day reads a static H:MM, a day to a week reads whole days, and past a week the room shows the infinity mark. The schedule is pinned in `vectors/live-activity/clock-schedule.json`, and both the widget's register law and the server's push schedule conform to it. A register change applies only when the widget renders, and the widget cannot schedule its own renders, so the hour boundary carries a server guarantee: when the boundary passes with no update pushed since, the server sends a clock push, an `update` re-asserting the last sent content-state byte for byte. The clock push is deliberately exempt from dedupe, because the render is the message, not the bytes. Any organic update past the boundary satisfies the guarantee instead, and the server fires shortly after the boundary rather than at it, so the device's own clock has crossed the flip before the render lands. A clock push also takes a longer `apns-expiration` than a progress update: it stays honest whenever it is delivered, since the device re-derives the register from its own clock at render, and `aps.timestamp` ordering discards it when a newer frame already applied.

Swift decoding MUST stay tolerant of unknown keys: the payload grows by expand/contract (an additive field bumps nothing, section 14), and the two sides deploy on different clocks. The widget ships inside the app and updates only on an App Store release, while the server deploys independently and continuously, so the server may add a field the installed widget has never seen. The widget MUST ignore any key it does not recognize rather than fail to decode, exactly as section 3 requires of the WebSocket receiver.

### REST endpoints

Both are bearer-authenticated with the same tokens as the rest of the API, and live on the core API alongside the section 12 routes.

| Route                                               | Who    | Behavior                                                                                                                        |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `POST /games/{gameId}/live-activity-tokens`         | member | `{ token, environment }` registers an ActivityKit per-activity update token; upsert on token conflict; `204`                     |
| `DELETE /games/{gameId}/live-activity-tokens/{token}` | member | unregister a token; idempotent (`204` even if the row is gone); a caller may delete only rows whose `user_id` is their own       |

`POST` requires the caller to be a member of the game (any role), the same membership gate the section 12 member endpoints use: a non-member is `NOT_PARTICIPANT`, an unknown game `GAME_NOT_FOUND`, and a missing token or an `environment` outside `{ sandbox, production }` is `VALIDATION`. The write is an upsert on the token (its primary key), so a re-registration after an app restart refreshes the row rather than erroring. `environment` records which APNs host minted the token: a Debug build mints a sandbox token, so the emitter must push to `api.sandbox.push.apple.com` for it and `api.push.apple.com` for a production token, never the wrong host.

`DELETE` is idempotent and returns `204` whether or not the row existed, so an app tearing down its activity never has to check first. The delete is scoped by `user_id` as well as token, so a caller can remove only their own registrations; another user's token is never touched, and the response does not reveal whether it existed.

The registry is API-owned (single writer `crossy_api`, INV-7); the push emitter reads it under a SELECT grant, the same cross-service read-coupling shape section 12 already uses for the completion and avatar reads. It carries no board content: a token, the owning `user_id` and `game_id`, the environment, and a `created_at`, nothing solution-bearing (INV-6). Rows are short-lived by nature: a lock-screen Live Activity caps at about 12 hours, so a token older than that is dead. The reader filters by a `created_at` window rather than trusting the table to be swept, so no sweeper job is required for correctness; a stale row simply falls outside the window.

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

Planned additions under the same fixture: word-bounds cases, next-word (Tab) and previous-word (Shift+Tab) traversing the circular cross-axis clue cycle (every across clue then every down clue), Tab skipping full clues to land on the next clue's first empty cell, typing wrap at word end (incomplete wraps to start, complete stays), and backspace stepping back through an already-empty cell. Tab's cycle and axis crossing follow the owner decision 2026-07-10, which supersedes v2's same-axis wrap.

**Completion matrix vectors** (reducer cases plus actor integration): repeated completion attempts yield exactly one `gameCompleted`; a filled-but-wrong board emits nothing and stays `ongoing`; **a full-but-wrong board made correct by an in-place overwrite (no change to `filledCount`) completes exactly once**; two players filling the last two cells concurrently yield exactly one completion; any mutation after completion is rejected; a client disconnected across the completion learns of it from the snapshot.

**Check vectors** (`check` family): the completion case shape (it needs `given.solution` for the comparator), with `given` optionally carrying standing `checkedWrong` marks and a `checkCount`, and `then.state` asserting both. The suite pins: an accepted check on a full-but-wrong board emits one `puzzleChecked` with `wrongCells` ascending and exactly the comparator failures (first-char rebus acceptance included); the gates (`GRID_NOT_FULL` below full, `GAME_NOT_ONGOING` on a terminal board); mark clearing on value change only (a same-value no-op keeps the mark, a different letter or a clear removes it, an edit elsewhere touches nothing); a second check replacing marks wholesale and incrementing the count; and the completion interplay (correcting the last wrong cell completes with zero standing marks).

**Client-store vectors** (run in both vitest and XCTest, like the engine): given sequenced state plus an overlay plus an incoming message (`cellSet`, `error`, `sync`, or a crash-rollback snapshot), assert the resulting overlay and rendered cells, and where a case pins it the store's derived `firstFillAt` (the timer origin the first fill's `cellSet` carries on the delta path, section 6). A non-fatal `error` is in scope because it is what clears the immortal overlay (section 8), the case this family must cover. These pin the duplicated web + iOS reconciliation logic (overlay clear on echo, gap-to-sync re-send, rollback) where drift is most expensive, and cover the immortal-overlay case in section 8.

**Clue-runs vectors** (`clue-runs` family): given a raw vendor-HTML clue string, assert the normalized `{text, runs}` the section 12 laws produce. Each case cites the law it defends. Like `client-store`, this is a _foreign_ family: its consumer is the clue-run parser and renderer in `apps/web` and iOS, not `packages/engine`, so the engine runner shape-validates it but never executes it. The cluster covers each style in the vocabulary, nesting-to-set flattening, adjacent merge, unknown-tag stripping, the `<br>` forms, entity decoding and the parse-before-decode order law, whitespace collapse across a style boundary, trimming an emptied run, the starred-clue literal, the markup-only clue, and the two malformed-tag shapes (section 12 law 12).

## 14. Versioning

- `protocolVersion` bumps on any breaking change: removing or retyping a field, changing semantics, adding a required field. Additive optional fields do not bump; clients already ignore unknowns.
- The server supports N and N-1. The deprecation window follows the iOS release cadence; App Store review lag is the reason N-1 exists at all.
- Every bump requires: a changelog entry here, updated vectors, the prior version's vectors frozen under `vectors/frozen/vN-1/` and run in CI against the current server (otherwise "supports N-1" is asserted, not tested), and both clients green in CI before deploy.

**Pre-release amendments.** While v1 is the only version ever deployed and every client deploys continuously from main, v1 may be amended in place, including breaking changes such as a new sequenced event, by owner ruling (2026-07-15). The bump discipline above starts at the first externally frozen release.

Changelog: v1, 2026-07-07, initial. Amended 2026-07-15 (pre-release, owner ruling): room check lands as the sequenced `puzzleChecked` plus the `checkPuzzle` command, `GRID_NOT_FULL`, and the board payload's `checkedWrongCells`/`checkCount`; the never-implemented per-user `checkRequest`/`checkResult` pair is removed (the room check is the only check).
