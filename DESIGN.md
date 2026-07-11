# Crossy v4 Design

Status: draft 1, for review. Date: 2026-07-07.
Companion: `PROTOCOL.md` (the wire contract and conformance vectors).
**Ownership of overlapping facts:** the wire format, message schemas, completion and comparator semantics, reconnect, and role gates are owned by `PROTOCOL.md`; this document links to them rather than restating them normatively. Where the two disagree on such a fact, `PROTOCOL.md` wins and the divergence is a bug. This document owns architecture, data model, and rationale.
This document stands alone. Two frozen extraction reports (`reports/v2-spec-extraction.md`, `reports/v3-mining.md`) hold exact constants and history; nothing here requires them.

## 1. What Crossy is

Crossy is a real-time collaborative crossword solver. A few friends open the same grid in a browser or the iOS app and solve it together. Letters appear as anyone types, everyone sees everyone else's cursor, and the room shares one timer. Players bring their own puzzles as JSON files in the XWord Info format, uploaded directly or fetched from a URL. A game is shared with a single link. When the grid is filled correctly, the timer freezes and the room celebrates.

The product bet: the multiplayer layer is the product. Single-player crossword apps have a hundred competitors. A room where four friends on a call watch each other's cursors dance has almost none.

Scope for v4: private games among friends, joined by link.

Non-goals for v4, recorded so nobody quietly builds them: offline solving, a public puzzle registry or discovery surface, a puzzle constructor, AI features, analytics UI (the data is kept, see D16), Android.

## 2. The domain, briefly

Crossword basics, for readers new to them. A grid is a rectangle of cells stored as a flat, row-major array; index `i` maps to `row = floor(i / cols)`, `col = i mod cols`. Some cells are black squares (blocks): unplayable, and they partition the rest into words. A word is a maximal horizontal (across) or vertical (down) run of playable cells. Each word starts at a numbered cell and has a clue. Special cases this system supports: rebus cells, where the solution for one cell is a short string rather than a single letter; circled cells, a visual overlay; clues containing images; and clues that cross-reference other clues ("See 17-Across").

Collaboration vocabulary, used precisely everywhere in this repo:

- **Puzzle**: the immutable template. Layout, numbers, circles, clues, and the solution. Produced by ingestion (section 7).
- **Game**: one shared solving session of a puzzle. Has a board, participants, and a status: `ongoing`, `completed`, or `abandoned`.
- **Board**: the players' in-progress fill. One value or null per cell.
- **Command**: a client's intent. Place a letter, clear a cell, request a check.
- **Event**: a fact the server has ordered and applied. Cell set, game completed. Events carry a per-game sequence number (`seq`).
- **Participant**: a user in a game, with a role: `host`, `solver`, or `spectator`.
- **Guest**: an anonymous account that can later upgrade to a full account in place, keeping its identity.

Three domain rules worth stating up front:

**Completion.** A game completes when every playable cell passes the comparator (section 5). The server notices this on its own as a consequence of applying events. Clients never claim completion.

**Conflict.** When two solvers write the same cell near-simultaneously, the server's order decides and the later event stands. The losing client sees its letter flip to the winner's, with a brief flash in the winner's color. Nothing is lost silently: every accepted event is in the log, attributed.

**Timer.** Derived, never stored. It starts at the first fill event and ends at the completion event, both server-timestamped. Clients render elapsed time; none of them owns a clock. There is no pause.

## 3. Architecture overview

Two services, one database, one bought identity provider.

```
 web SPA ──────┐                        ┌── Supabase Auth (Apple, Discord, guests)
 iOS app ──────┼── WebSocket ── session service ──┐
               │                (actor per game)  ├── Postgres (Supabase-hosted)
               └── REST ─────── core API ─────────┘
                                (modular monolith)
```

- **Core API** (stateless, TypeScript): REST. Identity and membership, puzzle ingestion, game creation and joining, link previews, archive reads. A modular monolith: internal modules with enforced boundaries, one deployable.
- **Session service** (stateful, TypeScript): WebSockets. One in-memory actor per live game. The actor is the single writer for its game: it sequences commands into events, applies them through the pure reducer, broadcasts, and persists asynchronously.
- **Postgres**: the system of record.
- **Supabase Auth**: bought authentication, hidden behind a port (section 8).

**Why an actor: history.** v2 wrote every keystroke to Postgres and rebroadcast it through Supabase Realtime, so the data plane saw everything. What it lacked was a behavioral locus: the write RPC mutated a cell and exited, and no component owned reacting to the transition. Domain behavior was exiled to wherever it fit. Completion detection ended up in three places (a client effect, a SQL status guard, an unauthenticated API route) that could disagree. That is the anemic-model failure. The actor gives the Game aggregate a runtime: its invariants execute in one place, in memory, on the write path. Concurrency correctness falls out of the same move, because a single mailbox is a total order.

**A keystroke, end to end** (the whole system in six steps):

1. A solver types `A`. The client applies it to a local optimistic overlay and sends `placeLetter{commandId, cell, value}` over its WebSocket.
2. The game's actor takes the command from its mailbox and validates the context gates it owns: connection already authenticated and membership-checked, role allows mutation, cell playable, game ongoing.
3. The reducer normalizes the value (ASCII-only, INV-1) and computes the transition: new state plus a `cellSet` event carrying the next `seq`; a value that leaves the `A-Z0-9` charset is rejected `INVALID_VALUE`. Normalization lives in the reducer, not the actor, so the two ports stay byte-identical, and the reducer vectors pin it there.
4. The actor broadcasts `cellSet` to every connection in the game. The writer's client matches `commandId` and clears its overlay entry; other clients apply the event, flashing the cell if its visible value changed.
5. The event enters the write-behind buffer. Within about five seconds or twenty-five events it flushes, together with the board snapshot, to Postgres in one transaction.
6. If the fill made `filledCount` equal the playable-cell count, the actor runs the comparator; on a pass it emits `gameCompleted` (flushed synchronously before broadcast) and rejects all further mutations.

**Bounded contexts** and where they live:

| Context               | Kind        | Runs in                             |
| --------------------- | ----------- | ----------------------------------- |
| Gameplay              | core domain | session service (actor + engine)    |
| Puzzle catalog        | supporting  | API module (owns the ingestion ACL) |
| Identity & membership | supporting  | API module + auth port              |
| Archive & read models | supporting  | API module                          |

Services do not map one-to-one onto contexts; the API hosts three contexts as modules on purpose. Module boundaries inside the API are enforced by lint rules, not network hops.

## 4. Layering and repo

Hexagonal, kept light. Three rings; dependencies point inward only.

- **Domain** (`packages/engine`): reducer, comparator, navigation. Pure functions: no IO, no clock, no randomness, no ambient identity. Timestamps and user ids arrive as data on commands. This is the code the golden vectors pin.
- **Application**: actor mailbox and lifecycle, flush scheduling, command handlers, membership cache. Orchestrates domain calls; knows nothing of wire formats or SQL.
- **Adapters**: WebSocket codec (per `PROTOCOL.md`), Postgres repositories, the auth port, the internal service-to-service endpoint.

Clients mirror the shape: protocol codec / store (client reducer + optimistic overlay + connection state machine) / views. The SwiftUI app follows the same three rings.

Enforcement: one `eslint-boundaries` (or dependency-cruiser) rule that fails the build when an inner ring imports outward. That rule is the entire layering ceremony.

Engine cohesion: three submodules with different change drivers. `reducer` (server correctness; shared by web and session service), `navigation` (client feel; never crosses the wire), `comparator` (server-only, because it needs solution data; the code itself is public). One vectors suite covers all three.

Repo layout (pnpm workspaces; no build orchestrator until it hurts):

```
packages/engine      pure domain: reducer, navigation, comparator
packages/protocol    message schemas; generated TS and Swift types
apps/api             core API (modular monolith)
apps/session         session service (actors)
apps/web             Vite React SPA
apps/ios             SwiftUI app (Swift engine port lives here)
vectors/             conformance vectors (normative; see PROTOCOL.md §13)
reports/             frozen v2/v3 extraction references
DESIGN.md  PROTOCOL.md
```

CI jobs: lint + unit + TS vectors on every push; Swift vectors on a macOS runner, path-filtered to `apps/ios/**` and `vectors/**`; integration against Testcontainers Postgres; a tiny Playwright smoke.

## 5. The engine

**Reducer**: `(state, command, meta) -> {events, state'} | rejection`. State holds `cells` (value or null, last writer), `filledCount`, `status`, `firstFillAt`, `seq`. Deterministic: same inputs, same outputs, byte for byte, in TypeScript and in the Swift port.

**Command vocabulary** (wire detail in `PROTOCOL.md`): `placeLetter`, `clearCell`, and `checkRequest` reach the reducer or comparator through the actor; `moveCursor`, `heartbeat`, and `requestSync` never touch domain state.

**Values**: normalized by the reducer, not the actor, so both ports agree byte for byte (INV-1). Uppercase, charset `A-Z0-9`, length 1 to 10 (10 covers observed rebus answers; revisit against real data). `null` clears. Digits are kept for v2 parity. Normalization is **ASCII-only**: map `a-z` to `A-Z` and leave every other code point unchanged, then validate against `A-Z0-9`. Locale-aware casing (`toLocaleUpperCase`, `uppercased(with:)`) is forbidden: it diverges across the TypeScript and Swift ports (Turkish `i` to `İ`, U+0130) and would break INV-1. A code point that uppercases outside `A-Z0-9` is rejected as `INVALID_VALUE`, identically on both ports.

**Two-phase completion.** The reducer maintains `filledCount`; equality with the playable-cell count is a cheap gate. The gate is **level-triggered, not edge-triggered**: on every accepted mutation, if `filledCount` equals the playable-cell count, the actor runs the comparator over the whole board, including an overwrite that leaves `filledCount` unchanged, because a full-but-wrong board becomes correct exactly by such an in-place overwrite. Only a full pass emits `gameCompleted`; filled-but-wrong emits nothing and play continues. Re-checking only on the transition to full would strand a board corrected in place. This still avoids comparing on every keystroke and makes "exactly one completion" trivial inside one mailbox.

**Comparator.** A filled value passes for a cell if, case-insensitively, it equals the full solution string or equals its first character. First-char acceptance is the puzzle format's own rebus convention; v2 shipped first-char-only by accident, v4 adopts either-accept on purpose. The comparator runs only server-side because it needs the solution.

**Navigation** (client-side domain logic; the exact cases are vectors, `PROTOCOL.md` §13):

- Word bounds: scan from the cell to a block or grid edge in each direction along the current axis.
- Advance: skip blocks; when moving forward, also skip filled cells, but if the word is full to its end, fall back to the immediately next cell.
- `canEscapeWord` (a `getNextCell` parameter): when false, forward advance stops at the current word's last cell instead of crossing into the next word; when true, it may cross a block into the next word. The flag only bites at a word boundary; mid-word it is a no-op. (Semantics inferred from the v2 seed vectors; confirm against `reports/v2-spec-extraction.md` when that report lands.)
- Grid edges clamp: never move past the first or last index.
- Tab traverses one circular cycle, every across clue in clue order then every down clue in clue order (owner decision 2026-07-10, superseding audit Verdict 1's same-axis, no-cross wrap). It skips full clues and lands on the next clue's first empty cell, crossing from across into down and wrapping back around; the cursor takes the landing clue's axis. Shift+Tab scans the same cycle backward. When nothing is empty anywhere, Tab still steps to the adjacent clue (its first cell on Tab, its last on Shift+Tab) so navigation stays live after completion. An out-of-range, block, or empty-grid position clamps to the first playable cell with direction unchanged.
- Typing at a word's end wraps to the word's start if the word is incomplete, else stays on the last cell.
- Backspace clears the current cell; if it was already empty, it steps back and clears the previous cell.
- Arrow keys along the current direction move; across it, they toggle direction. Clicking the selected cell toggles direction. On touch, a swipe along the direction is Tab, and across it toggles (v2 shipped toggle; v4 adopts it as intended behavior).
- Initial position: first playable cell, direction across.

## 6. Session service

**Actor lifecycle.**

- _Hydrate lazily._ The first connection for a game loads `games` plus `game_state` (board snapshot and `last_seq`) and constructs the actor. `cell_events` is not read on hydration (it is read once on the completion path, for the `participantCount` stat).
- _Serve from memory._ All validation and state live in the actor. Postgres is never on the keystroke path.
- _Write-behind._ Events buffer; events and the snapshot flush in one transaction every ~25 events or ~5 seconds, on transition to idle, and on SIGTERM (drain before exit). `gameCompleted` and `gameAbandoned` flush synchronously before they are broadcast.
- _Passivate._ After ~30 minutes with no connections: final flush, drop the actor. Safe because Postgres is the system of record; any later visit rehydrates. This deletes v3's background sweeper: no state exists only in memory beyond the flush window.
- _Crash._ A hard kill loses at most the unflushed tail, roughly five seconds of typing. Snapshot and events flush together, so the restore point is internally consistent. Honest consequence: the restored `seq` can be lower than what connected clients already saw. The protocol defines the client rollback rule. Client re-offer of lost commands is a planned stretch, and it is safe **only because the flushed snapshot carries the last K applied `commandId`s** (section 9), so dedup survives passivation and crash. The in-memory dedup set alone does not survive the crash it is invoked for: without persisted `commandId`s a re-offer after rehydration is not recognized as a duplicate and can regress a value that superseded it.

**Transport compression.** `permessage-deflate` is enabled on snapshot frames only, the reconnect `welcome` and `sync` board, never on the keystroke stream (SP4, `reports/spikes/sp4-ws-library-snapshot-size.md`). Steady-state traffic is tiny `cellSet` frames where deflate does not pay and can inflate, and a standing per-connection zlib context costs roughly 220 KB per socket on `ws`. Compressing only the rare snapshot keeps PROTOCOL.md section 1's resync budget (a worst-case 25x25 board is 2.95 KB compressed) with no standing memory cost.

**Presence and cursors** flow through the actor but are ephemeral: no `seq`, no persistence. Heartbeat every 15 s; 45 s with no inbound frame of any type (heartbeat or command) broadcasts a disconnect, so an actively typing client is never marked away. Cursor updates are throttled to 10/s.

**Membership.** The session service verifies membership, role, and the denylist at connect, and caches the result. It never mutates membership; that is the API's job. When the API changes membership (kick, role change, abandon), it calls one internal endpoint, `POST /internal/games/{id}/membership-changed`, authenticated with a static bearer secret. This endpoint is assumed reachable only on the provider's private network (confirm at M1, see section 15); the bearer is defense-in-depth on an already-private channel, not the sole trust boundary, and its blast radius is a forced re-verification or disconnect, never data access. The request body is a hint with one exception. For a kick or role change the actor re-reads membership and the denylist from Postgres and acts on that, so a leaked bearer cannot assert a membership fact. Abandon is the exception where the body is authority, and it can be, because abandon changes no API-owned table the session could re-read: there is nothing authoritative to reconcile against, so the `change` and its `by` drive the write directly. The enforcement also splits by liveness. A kick or role change touches only a live actor's connected sockets and never hydrates: it re-verifies each connected user, disconnects anyone no longer allowed, and refreshes the rest. A passivated game has no live sockets, so that path is a no-op, and the denylist plus connect-time re-verify enforce the change at the next connect. Abandon hydrates the actor on demand (only the actor may write `game_state`), which emits and synchronously flushes `gameAbandoned`; abandon on an already-terminal game is a no-op (INV-4).

## 7. Core API

Modules: identity & membership, puzzle catalog, games, archive.

**Puzzle catalog owns the anti-corruption layer.** Ingestion translates XWord Info JSON into the internal Puzzle model exactly once, at the boundary. Nothing downstream ever parses the external format.

- Clues become structured `{number, text, cellIndices}` at ingestion. v2 parsed `"17. Some clue"` strings three inconsistent ways at render time; that dies here.
- Feature detection with named rejection. Accepted: standard grids, rebus cells, circles (including shaded circles as a render variant), clues containing HTML and images, cryptic-style clue text. Rejected, each with a specific reason: barred grids, diagramless, uniclue, degenerate grids (zero playable cells, which would make completion vacuous or unreachable), and unsolvable puzzles (see the solvability check below). Unknown extra fields are ignored; known-incompatible flags reject.
- Bounds: 25x25 maximum. A full board at this cap is roughly 30 KB of raw JSON (a per-cell `{v, by}` with a UUID `by`), well under 20 KB with `permessage-deflate`; v2's uncapped grids were an accident, not a decision. See PROTOCOL.md section 1 for the resync-size contract.
- Solvability check. Every solution cell must be enterable: a cell is enterable iff its solution's first character is in `A-Z0-9` after ASCII-uppercasing (first-char acceptance, D12, then makes the cell completable), or the whole solution matches `^[A-Z0-9]{1,10}$`. Reject, with a named reason, any puzzle with a cell no legal input can satisfy, for example a rebus cell whose solution is `&`. A cell like `A&B` is accepted, because typing `A` completes it. This is the solution-side counterpart to the `INVALID_VALUE` input rule.
- Solutions live in the internal model and never leave the server (INV-6). INV-6 is enforced **structurally, not by runtime stripping**: `packages/protocol` defines two distinct types, `ServerPuzzle` (with solutions) and `ClientPuzzle` (no solution field, including no answers embedded in clue structures), and every client-facing payload is typed `ClientPuzzle`, so a leak is a compile error rather than a missed strip. v2 leaked solutions embedded in clues precisely because stripping was a runtime discipline; v4 removes the discipline. A serialization golden asserts no client payload carries a solution-typed field.

A second ACL, same idea, different boundary: the auth port (section 8) translates vendor identities into internal users. Both are named ACLs on purpose; one vocabulary.

**Games module**: create (full accounts only), join by invite code (any authenticated user, guests included; a new membership seats a full account directly as `solver` so a joiner plays at once, and a guest as `spectator`, owner decision 2026-07-10; an existing member keeps their role, the join upsert is non-demoting), self-upgrade `spectator` to `solver` (the path a pre-existing spectator and a former guest still use), kick (denylist plus notify; the host cannot kick themselves), abandon (host only), and the game view (solution-stripped puzzle, membership, session endpoint; no board, since the API holds no `game_state` read grant and the mutable board arrives over the WebSocket, PROTOCOL.md section 12). Host succession: if the host is tombstoned or deletes their account, host passes to the earliest-joined remaining `solver`; if none remains, the game auto-abandons, so a game is never left unadministrable. The auto-abandon stamps `gameAbandoned.by` (PROTOCOL.md section 6) with the departing host's `user_id`, the same id the deletion path carries into the abandon signal.

**Invite links**: `/g/{code}`, 8 characters from the unambiguous alphabet `[2-9A-HJ-NP-Z]`, crypto-random, lookups rate-limited. The code is a capability; a kicked user still holds the link, so kick writes a per-game denylist checked at join and at connect. The API serves `/g/{code}` as a small HTML shell with OpenGraph tags, plus `/og/{gameId}` rendering a grid-layout preview image (satori), **geometry only, never fills**, from solution-stripped `ClientPuzzle` data. The endpoint is public and third-party-cached, so it MUST NOT expose in-progress board state. Link unfurlers do not execute JavaScript, so the SPA cannot do this itself.

**Authorization** lives in API code, where it is unit-testable. Each service connects with a least-privilege Postgres role granted only the tables it owns per section 9. The session service additionally gets read-only grants on `games`, `memberships`, `game_denylist`, and `users` (display name and avatar URL only, the two fields the participant payload carries), so a leaked service credential is bounded to that role's surface. Postgres row-level security is configured deny-all as a tripwire for any future `authenticated`-role path; it is not defense for the service roles, which necessarily bypass it, and no feature depends on it.

**CORS.** The web SPA loads from a static host on a different origin than the API (D07, D17), so the REST surface requires CORS response headers scoped to the allowed web origins. This is a firm deploy-time configuration requirement, not an open question: the browser blocks cross-origin REST calls without it. It is configured per deploy from the web origin, alongside `DATABASE_URL` and the internal-bearer secret.

**Internal signaling config.** Two deploy-time variables gate the cross-service membership signal (section 6). `INTERNAL_BEARER_TOKEN` is the shared static secret: the session service requires it on `POST /internal/games/{id}/membership-changed`, compares it in constant time, and fails closed with `503` when it is unset, so a deploy that forgets it serves the endpoint to no one rather than open. `SESSION_INTERNAL_BASE` is the session's private base URL, read on the API side; when it or the bearer is unset the API's notifier is a deliberate no-op, so a local stack runs without either. A dropped or absent notify never blocks a kick or role change, since the denylist still refuses a kicked user at reconnect (section 2); only abandon, which only the actor can execute, treats a failed notify as a fault.

## 8. Identity, guests, roles

**Bought**: Supabase Auth handles Sign in with Apple, Discord OAuth, and anonymous sign-in. Apple is mandatory on iOS once any third-party login exists (App Store rule).

**Owned**: a `users` table keyed by the same UUID the provider issues, populated by a just-in-time upsert in API middleware on the first authenticated request. Every foreign key points at our table; nothing in our schema references the vendor's auth schema. The auth port ships one request-path function, `verify(token) -> {sub, isAnonymous}`: the pure, local, zero-network check both services run on every request (SP2). Two vendor mutations this section once grouped with it live in the API's identity module, not the shared port (decision recorded in `packages/auth`): `linkIdentity` is a client-driven OAuth flow the server only observes (SP1), and `deleteUser` is a Supabase admin (`service_role`) network call paired with an API-owned tombstone write (single writer, INV-7). Neither belongs on the per-request verification port. Services verify JWTs locally against the provider's published keys; no network call per request. Swapping providers later means reimplementing the port and the identity module's vendor calls, and nothing else.

**Guests.** The first join as a guest mints a real anonymous user, device-bound via stored session (Keychain on iOS, localStorage on web). Everything keys on `user_id` and auth method is an attribute, so a later Apple or Discord sign-in links the identity in place and history survives. Guests are join-only: creating a game requires a full account, so every game has an accountable owner. Guest creation is rate-limited by IP. Stale anonymous users are reclaimed by a periodic job.

**Deletion is a tombstone where events exist.** Account deletion is two operations, not one. Removing the *vendor* identity is a Supabase admin (`service_role`) network call, owned by the API's identity module. Tombstoning the mirror row is a separate write to the API-owned `users` table (single writer, INV-7): that write and the stale-guest job scrub PII (display name, avatar) but retain the stable `user_id`, because `cell_events` is immutable and INV-1 replay and INV-2 contiguity depend on it. `cell_events.user_id` is therefore never a cascading foreign key. `memberships` and `game_denylist` rows for a tombstoned user are removed; event attribution survives as an opaque, PII-free id, rendered as "former participant."

**Display identity**, everyone: a chosen display name plus a deterministic color from a hash (FNV-1a) of `user_id`, stable across devices, sessions, and clients.

**Roles**: `host` (creator), `solver`, `spectator`. Following an invite link seats a full account directly as a solver so a joiner can play at once, and a guest as a spectator (owner decision 2026-07-10); the join is a non-demoting upsert, so an existing member keeps their role. A pre-existing spectator (and a guest who later upgrades their account) still reaches solver with one tap (`POST /games/{id}/role`); the host can kick (but not themselves; succession is in section 7). Guests never hold the solver or host role (owner decision 2026-07-09): the solver upgrade is refused `FULL_ACCOUNT_REQUIRED` and host succession skips guests, so every solver and host is a named, accountable account. Spectators receive everything and send nothing that mutates board state. They may broadcast a cursor (they are friends watching, and the moving cursor is the point), but clients suppress it by default (section 15).

## 9. Data model and ownership

Single writer per table. A shared database is a coupling sin when *write* ownership is ambiguous; this matrix removes that. Read-coupling remains and is not waved away: the session service reads several API-owned surfaces (`games`, `games.puzzle_snapshot`, `memberships`, `game_denylist`, and `users.display_name` plus `users.avatar` for participant payloads), and the API reads the session-owned `game_state.completed_at` for the completion surface and `MAX(cell_events.at)` for activity ordering on the signed-in home (below), so their column shapes are a published contract. Changes to them are expand/contract (add, backfill, migrate readers, then drop), never a breaking rename in one deploy, because the two services deploy independently against one database.

Single-writer for `game_state` rests on deployment topology, not a lock, so the `game_state` snapshot upsert carries a tripwire: it applies only when the stored row is still ongoing, or the incoming snapshot repeats the stored terminal status, and the incoming seq is at least the stored seq. A terminal row is final (INV-4): it accepts only an identical-status reflush, never a rollback to ongoing and never a switch between completed and abandoned. A second writer (deploy overlap, a replica misconfiguration) then surfaces as a loud flush fault (`SnapshotRegressionError`) instead of a silent clobber that would drop a newer seq or overwrite a terminal outcome. It is a tripwire, not a coordination mechanism: it detects a second writer, it does not make two writers safe.

The coupling was one-directional at first: the API held no read grant on the session-owned `game_state` or `cell_events`. Two signed-in-home surfaces brought the planned expand forward, each a SELECT-only grant that leaves single-writer (INV-7) intact because INV-7 governs writes, not reads. The completion surface added a grant on `game_state` (migration 0005), so `GET /games` can report a game's completion (`game_state.completed_at`, PROTOCOL.md section 12) without ever writing the table. Activity ordering added a grant on `cell_events` (migration 0008), so `GET /games` can order rooms by most recent activity, `MAX(cell_events.at)` per game (PROTOCOL.md section 12), again reading only an aggregated timestamp, never a cell `value` or the board, so no solution content leaves the server (INV-6). The session stays the sole writer of both tables. The Archive module (section 7) will extend the `cell_events` read from the max-timestamp aggregate to the full event stream, and read the rest of `game_state`, for solve replay and the deferred read models (D16). That fuller replay read remains a planned expand when the Archive module lands, not now; it is recorded here so the gap is visible rather than silent.

| Table           | Writer  | Purpose                                                                                             |
| --------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `users`         | API     | identity mirror (JIT upsert): display name, avatar, `is_anonymous`                                  |
| `puzzles`       | API     | internal puzzle model including solutions (jsonb), features, source metadata                        |
| `games`         | API     | session identity: `puzzle_id`, `puzzle_snapshot` (jsonb), `invite_code`, `created_by`, `created_at` |
| `memberships`   | API     | `(game_id, user_id, role, joined_at)`, `UNIQUE(game_id, user_id)`; join and role change are upserts                                                               |
| `game_denylist` | API     | `(game_id, user_id)`: kicked users                                                                  |
| `game_state`    | session | `status`, `board` (jsonb), `last_seq`, `first_fill_at`, `completed_at`, `abandoned_at`, `stats`, `recent_command_ids` (bounded ring of the last K applied `commandId`s) |
| `cell_events`   | session | append-only event log                                                                               |

`cell_events(game_id, seq, cell, user_id, value, at, UNIQUE(game_id, seq))`; `user_id` is `ON DELETE NO ACTION` and is tombstoned, never cascaded (section 8), so the log stays contiguous through user deletion. Kept in full, indefinitely; at friends scale this is tens of megabytes a year. It buys deterministic bug reproduction (replay any game through the reducer) and, later, the analytics v3 designed (contribution map, effort heatmaps, solve replay) as plain queries. No analytics UI in v4.

`cell_events` holds only `cellSet` mutations. A terminal `gameCompleted` or `gameAbandoned` consumes a `seq` but carries no cell, so it is never appended: the log excludes the terminal `seq`. `participantCount` (PROTOCOL.md section 4) is therefore `DISTINCT user_id` over `cell_events`, computed inside the terminal flush transaction after the completing events are appended. Joiners and spectators never wrote a cell, so they never appear and never count, and the count survives passivation because it reads Postgres rather than actor memory.

`games` vs `game_state` is a split by writer, not by access pattern. v2 had the same shape (a separate status table) for broadcast-channel reasons; v4 keeps the shape with a better justification.

`puzzle_snapshot`: games denormalize the puzzle at creation, so a live game is self-contained. Puzzle edits or deletions cannot corrupt a game in flight, and the actor hydrates from one row plus `game_state`.

**Migrations**: Drizzle Kit, SQL committed in-repo, applied by CI. Cross-service schema changes are expand/contract: a breaking change to an API-owned table that the session service reads (section 9) is a two-release migration, never a rename in one deploy. The database dashboard is read-only by policy. Fresh-clone reproducibility is a launch gate: v2 could not be rebuilt from its repo, and that failure mode is retired here.

## 10. Clients

**Shared client contract**, both platforms: render sequenced state plus an optimistic overlay keyed by `commandId`; the echo of your own event clears its overlay entry; an event that changes a visibly different value triggers a ~300 ms flash in the writer's color; a sequence gap triggers a resync; the connection state machine is identical and specified in `PROTOCOL.md`. The timer renders from `firstFillAt` and `completedAt`; clients hold no clock state.

**Web**: Vite + React SPA on static hosting. Next.js was rejected: this client is an authenticated, WebSocket-driven app, server-side rendering of it serves nobody, and the framework would add a server tier with no job (link previews, the one real SSR need, moved to the API). The SVG grid carries over from v2 with its states intact: a 36-unit cell module scaled to fit; background precedence `black square > current cell > check/cross-reference highlight > active word > teammate-here > default`; clue numbers top-left; circles as inset rings; a teammate cursor drawn as a direction arrow plus avatar or initial, collapsing to a count when several teammates share a cell. Exact pixel constants live in the frozen v2 extraction; the rules above are sufficient to rebuild the look. Mobile web ships the fix for v2's worst gap: a tappable active-clue bar opening a bottom-sheet clue browser, an on-screen keyboard driving store actions directly, swipe along the solving direction for next/previous word and across it to toggle direction.

**iOS**: native SwiftUI, floor iOS 18 (owner ruling 2026-07-10, amending D06: the glass chrome needs iOS 26, so 18 through 25 renders the same chrome on one simple blur material, apps/ios/DESIGN.md section 4). The grid is a `Canvas` renderer implementing the same rules; the reducer is a small Swift port kept honest by the shared vectors in CI. Liquid Glass appears on chrome only (toolbars, clue bar, sheets, overlays); the grid surface stays solid and high-contrast for glyph legibility. WebSocket via `URLSessionWebSocketTask` running the same reconnect state machine. Sign in with Apple is native; Discord uses `ASWebAuthenticationSession`; invite links are universal links.

**Teammate presence anchors to the cell's bottom-right, clear of the clue number** (owner-approved, Wave 2.1d). The 1.1h playground found SP6's recovered teammate count-badge coordinates (top-right, offset +27,+10; `reports/spikes/sp6-v2-v3-recovery.md`) share the top band with the top-left clue number and crowd it, worst at three-digit numbers on a 25x25 grid. The rule, durable across web and iOS because it governs every client's presence render: keep the clue number top-left (+2,+10) and anchor the teammate presence stack to the bottom-right of the 36-unit module. Single teammate: direction arrow top-right (+27,+3, a 7-unit glyph), avatar circle bottom-right (center +30,+30, radius 5) with an 8px initial fallback. Several teammates sharing a cell collapse to a count badge in the same bottom-right slot (center +29,+29, radius 7, 9px count), never the top-right slot that collides. This is the placement the 1.1h playground already renders (`apps/web/src/ui/CrosswordGrid.tsx`); it supersedes the SP6 badge coordinate.

## 11. Testing

Stance: vectors are written before implementations; the spec is the failing test. Mock only at ports; infrastructure tests run real Postgres via Testcontainers. Test names cite the invariant they defend (`INV-n`), which makes coverage of the things that matter greppable.

| Suite               | Pins                                                                                                                                          | Tooling                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Engine vectors      | reducer, comparator, navigation semantics                                                                                                     | JSON vectors; vitest runner + XCTest runner     |
| Completion matrix   | the v3-derived edge catalog: double completion, filled-but-wrong, last-two-cells race, mid-keystroke completion, completion during disconnect | vectors + actor integration                     |
| Simulation harness  | convergence and freeze-after-completion under randomized delay, drop, reorder, disconnect, and reconnect across N simulated clients           | property-based (fast-check), seeded, replayable |
| Client store        | overlay reconciliation, gap-to-sync, crash rollback, reconnect state machine (the duplicated web + iOS logic where drift lives) | JSON vectors; vitest + XCTest, same as engine |
| Service integration | flush atomicity, hydrate, passivate, drain, membership-changed                                                                                | Testcontainers Postgres, real WebSockets        |
| Contract            | REST and WS schemas vs generated TS/Swift types                                                                                               | schema snapshot tests                           |
| Smoke               | two browsers solve a mini; one is killed mid-word; both converge                                                                              | Playwright, kept tiny                           |

The simulation harness is the regression fortress: every convergence bug it finds is a seed number, and every production bug is one log replay away from becoming a vector.

## 12. Invariants

- **INV-1 Determinism.** Identical event sequences produce identical states, across languages; casing and comparison are ASCII-only so the ports cannot diverge, and replay survives user deletion because deletion tombstones `users` and never touches `cell_events`.
- **INV-2 Total order.** Events per game carry contiguous `seq` from 1; only the actor assigns `seq`.
- **INV-3 Completion is durable and unique.** Exactly one `gameCompleted` per game, persisted before broadcast.
- **INV-4 Terminal states freeze.** No board mutation after `completed` or `abandoned`.
- **INV-5 Bounded durability.** Graceful shutdown loses nothing. A hard crash loses at most the unflushed tail (bounded by the flush policy), and the restored snapshot-plus-log pair is internally consistent.
- **INV-6 Solutions never leave the server**, in any payload; enforced structurally by the `ClientPuzzle` type (no solution field), not by runtime stripping.
- **INV-7 Single writer per table.** Ownership governs writes only; cross-service reads (the session service reads `games`, `memberships`, `game_denylist`, `puzzle_snapshot`, and `users.display_name` plus `users.avatar`) are a schema contract under expand/contract migration.
- **INV-8 The session service never mutates membership**; it verifies.
- **INV-9 Engine purity.** No IO, clock, randomness, or ambient identity inside `packages/engine`.
- **INV-10 Clients render sequenced state plus overlay only.** Overlay entries clear on echo (`commandId` match), on a non-fatal `error` for that `commandId`, or on snapshot reconciliation, never silently, and never left orphaned by a rejection.

INV-5 is deliberately honest: durability is bounded, not absolute, and the bound is a product decision (D14).

## 13. Milestones

Walking skeleton first; every later milestone is a vertical slice a friend can feel. Learning stays subordinate to product by construction: there is no infrastructure-only milestone.

- **M0 Repo + CI.** Monorepo scaffold; engine package with one deliberately failing vector in both runners; Testcontainers wired. Exit: a red vector fails CI in TypeScript and Swift.
- **M1 Walking skeleton.** Create a game via the API; two web clients over WebSockets through a real actor; `placeLetter` round trip; write-behind flush; kill and reconnect resyncs. Exit: two browsers converge after one is killed mid-word.
- **M2 Completion.** Two-phase completion, derived timer, confetti; completion matrix green end to end; simulation harness first green run. Exit: a full solve celebrates once, and only once, on both clients.
- **M3 Identity.** Apple, Discord, guest join by link; roles and upgrade; kick with denylist; abandon. Exit: a guest joins from a fresh phone, upgrades, keeps history; a kicked account finds the link dead.
- **M4 Mobile web.** Clue bar and bottom sheet, on-screen keyboard, swipes. Exit: a phone-only friend solves comfortably.
- **M5 iOS.** SwiftUI client to conformance: Swift vectors green, handshake, grid renderer. Exit: an iOS user and a web user finish a puzzle together.
- **M6 Mechanics parity.** Check, rebus input on both platforms, cross-reference highlighting, circles and shading, image clues. Exit: the v2 parity checklist is green.
- **M7 Polish.** OG link previews, passivation tuning, presence colors everywhere, nightly simulation runs. Exit: a link pasted in Discord unfurls with the grid image.

## 14. Decision log

Format: decision, why, rejected alternatives, cost. Status is adopted unless marked **adopted-by-default** (chosen without deep validation; cheap to revisit).

**D01 Per-game actor as ordering authority.** One in-memory process per live game sequences all commands. Rejected: database-as-sequencer (correct, but puts Postgres on the keystroke path and leaves behavior anemic); client-stamped CRDT (buys offline we do not need and complicates the trust boundary); managed sync platforms (hide exactly the parts worth owning). Cost: a stateful service to run and drain.

**D02 Server-ordered per-cell last-write-wins with visible attribution, not compare-and-swap.** The later sequenced event stands; the losing client sees the flip, flashed in the winner's color. Context that matters: v3 explicitly rejected LWW and built conflict UI, but it was rejecting v2's silent, unordered LWW. Ordered LWW with visibility keeps friends-scope UX simple and loses nothing from the log. Rejected: `expectedVersion` CAS with conflict unicasts (rejection ceremony friends resolve socially anyway). Cost: same-cell races resolve as flips, which must stay visible or v2's sin returns.

**D03 Two services plus Postgres; the API is a modular monolith.** Exactly one distribution boundary, at the real fault line: stateful realtime vs stateless CRUD. Rejected: one process (couples the deploy and failure of live sessions to CRUD); microservices (org-chart cosplay at team size one). Cost: one internal contract to maintain (section 6).

**D04 TypeScript services; the engine shared by web and server; a Swift port pinned by vectors.** One reducer serves both optimistic echo and authority; golden vectors double as cross-client conformance. Rejected: Go or Elixir servers (trade away reducer sharing; the language budget goes to Swift instead). Cost: a hand-kept Swift port, held honest by CI.

**D05 Supabase demoted to Postgres + Auth behind ports.** No client database credentials; no PostgREST, Realtime, Storage, or Edge Functions; vendor-neutral migrations; our own `users` table; JWTs verified locally. Rejected: all-in Supabase (couples every layer to a vendor); full exit (rebuilds bought commodities for no product gain). Cost: hand-written CRUD the SDK gave for free.

**D06 Native SwiftUI iOS, floor iOS 18 (amended 2026-07-10 from iOS 26), Liquid Glass on chrome only.** Rejected: React Native or Capacitor (would reuse the grid but blunt the native feel that motivated a native app at all). Cost: the grid renderer and reducer exist twice; vectors carry the correctness burden. Amendment: glass APIs need iOS 26, so 18 through 25 renders chrome on one simple blur material, a degraded experience the owner accepted; apps/ios/DESIGN.md section 4 owns the fallback rule.

**D07 Vite React SPA for web; link previews served by the API.** Rejected: Next.js (a server tier with no job here; SSR of an authenticated WebSocket app is meaningless). Cost: one small HTML + OG endpoint on the API.

**D08 Monorepo, everything in.** Engine, protocol, api, session, web, ios, vectors, reports, docs; pnpm workspaces; macOS CI path-filtered. Rejected: split repos (kills atomic protocol + vectors + both-clients changes). Cost: macOS runner minutes on iOS-touching changes.

**D09 Guests now, as anonymous-upgradeable identities; join-only; IP rate limits.** Everything keys on `user_id`; auth method is an attribute of identity. Rejected: accounts-only (kills click-link-and-play); game-scoped pseudo-identities (break the `user_id` axiom, make upgrade bespoke). Cost: a stale-guest cleanup job; an abuse surface bounded by join-only.

**D10 Spectator role modeled now; kick via per-game denylist.** Following an invite link seats a full account directly as solver so a joiner plays at once, and a guest as spectator (owner decision 2026-07-10); the one-tap upgrade remains for a pre-existing spectator and a former guest. Rejected: link rotation on kick (punishes everyone else holding the link). Cost: a denylist check at join and connect.

**D11 Server-noticed completion; solutions never leave the server; Check is a command.** The actor detects the full board, validates, emits. This deletes v2's claim endpoint, its "Verifying..." limbo dialog, and the stale-claim race, rather than fixing them. Cost: Check pays one round trip, roughly 50 ms; a deliberate button press tolerates it.

**D12 Rebus: comparator accepts full string or first character, case-insensitive; buffer input on web, inline field on iOS.** First-char is the format's own convention; v2's first-char-only was accidental, this is chosen. Cost: comparator vectors must encode both acceptances.

**D13 Puzzle ingestion is an anti-corruption layer with named rejections; 25x25 cap; clues normalized at the boundary.** Rejected: v2's silent stripping (a diagramless puzzle would ingest and render wrong). Cost: some real puzzles are refused, with a reason the user can read.

**D14 Durability window: write-behind at ~25 events or ~5 s; drain on SIGTERM; synchronous flush for terminal events.** Deploys and restarts lose nothing; a hard crash loses seconds of typing in a friendly crossword. **Adopted-by-default**: the thresholds are guesses to tune with measurement.

**D15 Timer derived from the event log; starts at first fill; no pause.** Rejected: v2's game-creation start (penalized lobby dawdling); client clocks (skew). Cost: none found.

**D16 Full event log retained; analytics UI deferred.** Replay-driven debugging now; contribution maps, heatmaps, and solve replay later as queries over data that already exists. Cost: negligible storage.

**D17 Hosting: Railway for both services; Supabase stays for Postgres + Auth; the SPA on any static host.** Asynchronous flushes make cross-provider database latency tolerable; co-locate regions. Rejected: big-cloud (infrastructure ceremony is the learning budget we agreed not to spend); a VPS now (the ops itch is deferred, not denied); Workers/Durable Objects (platform-shaped learning). **Adopted-by-default**: not load-validated; Fly.io is the named alternate; Docker images plus `DATABASE_URL` keep the exit open.

**D18 Protocol: versioned handshake; the server supports N and N-1; full-snapshot resync; commandId dedup.** N-1 exists because App Store review makes iOS and web release on different cadences. Rejected: delta sync (complexity for a board this small, roughly 30 KB raw, well under 20 KB compressed). Cost: the two-version tax from the first iOS release onward, plus frozen N-1 conformance vectors (PROTOCOL.md section 14).

**D19 No offline in v4; events stay per-cell, versioned, string-valued.** That shape is CRDT-compatible, so a future local-first retrofit is not foreclosed. Cost: none now.

**D20 Command/event vocabulary; presence and cursors are ephemeral.** Client intents are commands; sequenced facts are events; presence never enters the log. Cost: presence is best-effort by design.

## 15. Open questions and uncertainty register

Each item names when it must close.

- Flush thresholds (25 events / 5 s) and passivation delay (30 min): guesses; measure and tune by M2.
- Railway under WebSocket load, and its pricing: validated by SP3 (`reports/spikes/sp3-railway-reality-check.md`). The edge is a transparent WebSocket proxy with no minute-scale idle close and it forwards the deflate negotiation header; idle two-service cost is memory-led, a few dollars a month at friends scale; no app sleep by default. Closed at Wave 2.2 (2026-07-09): the carried builder question resolved by decision, not by retry. The pipeline ships CI-built images from GHCR (never Railway's builder), and the first production rollout came through it green: build, push, `railway redeploy` per service. The deflate negotiation is also confirmed against the production session service (WS upgrade 101 with `permessage-deflate` negotiated through the real edge). Fly.io remains the named fallback, now purely precautionary.
- Region placement: choose at M0 when creating the database project; co-locate the services. Closed 2026-07-09 at deploy: Supabase `us-east-1`, Railway `us-east`, per the Wave 0.2c region note (owner is Toronto-based; Railway has no Canadian region, and service-to-database co-location beats owner proximity).
- Internal service-to-service auth: a static bearer on the provider's private network is assumed and must be confirmed at M1; blast radius is forced disconnects, not data. Revisit (rotation, mTLS) if the endpoint ever becomes publicly reachable. SP3 confirmed `service.railway.internal` is reachable service-to-service by plain HTTP on any port and is NXDOMAIN on the public internet, and that a service without a generated domain has no public endpoint. The static-bearer assumption holds: the `/internal` endpoint is not publicly reachable, so the blast radius stays forced disconnects, not data. Confirmed at M1 deploy (2026-07-09) on the production project: the session's public domain returns 404 for `/internal` (it is served only on the domain-less `INTERNAL_PORT`), and from inside the api service the private port answers 401 without the bearer, so the endpoint is served, private, and fail-closed.
- Kicking a non-member reuses `NOT_PARTICIPANT` to describe the *target* (`DELETE /games/{id}/members/{userId}` on a user with no membership row), while everywhere else that code describes the *caller*. The REST vocabulary (PROTOCOL.md section 12) has no target-not-a-member code, and none is invented here; the overload is recorded as a gap to settle when that vocabulary is next revised (Track B, M3b).
- Client re-offer of lost commands after a crash rollback: post-v1 stretch. Safe only given persisted `commandId`s in the snapshot (section 9, `recent_command_ids`); the in-memory dedup set does not survive passivation or crash.
- `recent_command_ids` window size K: a guess; tune with the flush thresholds by M2. K sets how many recently-applied commands a reconnecting client can safely re-send without a stale re-apply; pending commands older than K are dropped by the client, not re-sent. Open alongside it: how a client measures a pending command's age against K is itself unspecified (send-`seq` delta, applied-command count, or wall clock). The leading proposal is the `seq`-delta measure (PROTOCOL.md section 8); close by M2 with K, and until then implementations MUST NOT diverge on the measure.
- `welcome.protocolVersion` echo: which version the server echoes once N-1 is a real version (the negotiated N-1 or its own current N). Moot at v1, where the supported set is `{1}`, so the field is always `1`; a ruling is due before the first version bump (PROTOCOL.md section 2).
- Liquid Glass API details: verified at M5 kickoff (SP-i1, reports/spikes/sp-i1-glass.md). The floor is iOS 18 with one blur-material fallback below 26 (owner ruling 2026-07-10, D06 as amended).
- Guest IP rate-limit values and stale-guest cleanup cadence: set at M3.
- Spectator cursors: allowed by the protocol, suppressed client-side by default; revisit the default if spectating feels dead.
- Digits in the value charset: closed by SP5 (`reports/spikes/sp5-puzzle-corpus.md`). Real solutions are A-Z-dominant; digits occur and stay. No real puzzle needs punctuation in the *enterable* charset: first-char acceptance completes cells like `A/B`, and a whole-cell symbol (`/`, `+`) is a named ingestion rejection. Charset stays `A-Z0-9`.
- Rebus length cap of 10: closed by SP5. Observed max 4 in-sample, ~7 in the documented 94k-puzzle reference corpus; 10 kept with margin. Over-cap is a named rejection, not truncation. One cheap confirmation remains open: a `max`-length scan of the real XWord Info archive once it exists.
- Ingestion triggers unverified against live files: the `AMBIGUOUS_SOLUTION` trigger (a direction listing a duplicate clue number for one slot) and the `DIAGRAMLESS` trigger (a `type` of `diagramless` or a `diagramless: true` flag) are both coded to SP5's documented shape but not yet confirmed against real XWord Info JSON. Confirm both against the real archive, alongside the rebus-cap `max`-length scan above, once it exists. Barred and uniclue puzzles are deliberately left unimplemented: SP5 records no JSON field or flag that identifies either, so there is no trigger to code (PROTOCOL.md section 12).
- Comparator acceptance of an unenterable full-string solution: whether the full-string branch accepts a solution no legal input can produce, such as the literal `A/B` (which fails the input charset). Moot at runtime, because ingestion rejects whole-symbol cells and the input charset blocks entry, but the comparator rule text is silent and the vectors leave the unenterable full string in neither `accept` nor `reject`. Resolve before the comparator is considered final (PROTOCOL.md section 10).
- OG image visual parity with v2: nice-to-have, M7.
