# Crossy v4 Design

Status: draft 1, for review. Date: 2026-07-07.
Companion: `PROTOCOL.md` (the wire contract and conformance vectors).
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
2. The game's actor takes the command from its mailbox and validates: connection already authenticated and membership-checked, role allows mutation, cell playable, value legal, game ongoing.
3. The reducer computes the transition: new state plus a `cellSet` event carrying the next `seq`.
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

**Values**: normalized at the boundary. Uppercase, charset `A-Z0-9`, length 1 to 10 (10 covers observed rebus answers; revisit against real data). `null` clears. Digits are kept for v2 parity.

**Two-phase completion.** The reducer maintains `filledCount`; equality with the playable-cell count is a cheap gate. Only then does the actor run the comparator over the whole board, and only on a full pass does it emit `gameCompleted`. Filled-but-wrong emits nothing and play continues. This avoids comparing on every keystroke and makes "exactly one completion" trivial inside one mailbox.

**Comparator.** A filled value passes for a cell if, case-insensitively, it equals the full solution string or equals its first character. First-char acceptance is the puzzle format's own rebus convention; v2 shipped first-char-only by accident, v4 adopts either-accept on purpose. The comparator runs only server-side because it needs the solution.

**Navigation** (client-side domain logic; the exact cases are vectors, `PROTOCOL.md` §13):

- Word bounds: scan from the cell to a block or grid edge in each direction along the current axis.
- Advance: skip blocks; when moving forward, also skip filled cells, but if the word is full to its end, fall back to the immediately next cell.
- Grid edges clamp: never move past the first or last index.
- Tab targets the next clue's first empty cell, else the clue's start (its end on Shift+Tab); past either end of the clue list, wrap to the grid's first playable cell.
- Typing at a word's end wraps to the word's start if the word is incomplete, else stays on the last cell.
- Backspace clears the current cell; if it was already empty, it steps back and clears the previous cell.
- Arrow keys along the current direction move; across it, they toggle direction. Clicking the selected cell toggles direction. On touch, a swipe along the direction is Tab, and across it toggles (v2 shipped toggle; v4 adopts it as intended behavior).
- Initial position: first playable cell, direction across.

## 6. Session service

**Actor lifecycle.**

- _Hydrate lazily._ The first connection for a game loads `games` plus `game_state` (board snapshot and `last_seq`) and constructs the actor. `cell_events` is not read on hydration.
- _Serve from memory._ All validation and state live in the actor. Postgres is never on the keystroke path.
- _Write-behind._ Events buffer; events and the snapshot flush in one transaction every ~25 events or ~5 seconds, on transition to idle, and on SIGTERM (drain before exit). `gameCompleted` and `gameAbandoned` flush synchronously before they are broadcast.
- _Passivate._ After ~30 minutes with no connections: final flush, drop the actor. Safe because Postgres is the system of record; any later visit rehydrates. This deletes v3's background sweeper: no state exists only in memory beyond the flush window.
- _Crash._ A hard kill loses at most the unflushed tail, roughly five seconds of typing. Snapshot and events flush together, so the restore point is internally consistent. Honest consequence: the restored `seq` can be lower than what connected clients already saw. The protocol defines the client rollback rule, and client re-offer of lost commands is a planned stretch (commandId dedup already makes it safe).

**Presence and cursors** flow through the actor but are ephemeral: no `seq`, no persistence. Heartbeat every 15 s; 45 s without one broadcasts a disconnect. Cursor updates are throttled to 10/s.

**Membership.** The session service verifies membership, role, and the denylist at connect, and caches the result. It never mutates membership; that is the API's job. When the API changes membership (kick, role change, abandon), it calls one internal endpoint, `POST /internal/games/{id}/membership-changed`, authenticated with a static bearer secret. The actor re-verifies against Postgres and disconnects anyone no longer allowed. Abandon uses the same path: the API authorizes the host, the actor emits `gameAbandoned`.

## 7. Core API

Modules: identity & membership, puzzle catalog, games, archive.

**Puzzle catalog owns the anti-corruption layer.** Ingestion translates XWord Info JSON into the internal Puzzle model exactly once, at the boundary. Nothing downstream ever parses the external format.

- Clues become structured `{number, text, cellIndices}` at ingestion. v2 parsed `"17. Some clue"` strings three inconsistent ways at render time; that dies here.
- Feature detection with named rejection. Accepted: standard grids, rebus cells, circles (including shaded circles as a render variant), clues containing HTML and images, cryptic-style clue text. Rejected, each with a specific reason: barred grids, diagramless, uniclue. Unknown extra fields are ignored; known-incompatible flags reject.
- Bounds: 25x25 maximum. This bounds sync payloads under ~20 KB; v2's uncapped grids were an accident, not a decision.
- Solutions live in the internal model and never leave the server (INV-6). Client-facing puzzle views strip them, including answers embedded in clue structures.

A second ACL, same idea, different boundary: the auth port (section 8) translates vendor identities into internal users. Both are named ACLs on purpose; one vocabulary.

**Games module**: create (full accounts only), join by invite code (any authenticated user, guests included; role starts `spectator`), self-upgrade to `solver`, kick (denylist plus notify), abandon (host only), and the game view (solution-stripped puzzle, membership, board bootstrap).

**Invite links**: `/g/{code}`, 8 characters from the unambiguous alphabet `[2-9A-HJ-NP-Z]`, crypto-random, lookups rate-limited. The code is a capability; a kicked user still holds the link, so kick writes a per-game denylist checked at join and at connect. The API serves `/g/{code}` as a small HTML shell with OpenGraph tags, plus `/og/{gameId}` rendering a grid-layout preview image (satori). Link unfurlers do not execute JavaScript, so the SPA cannot do this itself.

**Authorization** lives in API code, where it is unit-testable. Postgres row-level security is configured deny-all as a tripwire: a leaked credential reads nothing, and no feature depends on RLS.

## 8. Identity, guests, roles

**Bought**: Supabase Auth handles Sign in with Apple, Discord OAuth, and anonymous sign-in. Apple is mandatory on iOS once any third-party login exists (App Store rule).

**Owned**: a `users` table keyed by the same UUID the provider issues, populated by a just-in-time upsert in API middleware on the first authenticated request. Every foreign key points at our table; nothing in our schema references the vendor's auth schema. The auth port is three functions: `verify(token) -> {sub, isAnonymous}`, `linkIdentity`, `deleteUser`. Services verify JWTs locally against the provider's published keys; no network call per request. Swapping providers later means reimplementing the port and nothing else.

**Guests.** The first join as a guest mints a real anonymous user, device-bound via stored session (Keychain on iOS, localStorage on web). Everything keys on `user_id` and auth method is an attribute, so a later Apple or Discord sign-in links the identity in place and history survives. Guests are join-only: creating a game requires a full account, so every game has an accountable owner. Guest creation is rate-limited by IP. Stale anonymous users are deleted by a periodic job.

**Display identity**, everyone: a chosen display name plus a deterministic color from a hash (FNV-1a) of `user_id`, stable across devices, sessions, and clients.

**Roles**: `host` (creator), `solver`, `spectator`. Links land you as a spectator; one tap upgrades to solver; the host can kick. Spectators receive everything and send nothing that mutates. By default they do not broadcast cursors.

## 9. Data model and ownership

Single writer per table. A shared database is a coupling sin only when ownership is ambiguous; this matrix removes the ambiguity.

| Table           | Writer  | Purpose                                                                                             |
| --------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `users`         | API     | identity mirror (JIT upsert): display name, avatar, `is_anonymous`                                  |
| `puzzles`       | API     | internal puzzle model including solutions (jsonb), features, source metadata                        |
| `games`         | API     | session identity: `puzzle_id`, `puzzle_snapshot` (jsonb), `invite_code`, `created_by`, `created_at` |
| `memberships`   | API     | `(game_id, user_id, role, joined_at)`                                                               |
| `game_denylist` | API     | `(game_id, user_id)`: kicked users                                                                  |
| `game_state`    | session | `status`, `board` (jsonb), `last_seq`, `first_fill_at`, `completed_at`, `abandoned_at`, `stats`     |
| `cell_events`   | session | append-only event log                                                                               |

`cell_events(game_id, seq, cell, user_id, value, at, UNIQUE(game_id, seq))`. Kept in full, indefinitely; at friends scale this is tens of megabytes a year. It buys deterministic bug reproduction (replay any game through the reducer) and, later, the analytics v3 designed (contribution map, effort heatmaps, solve replay) as plain queries. No analytics UI in v4.

`games` vs `game_state` is a split by writer, not by access pattern. v2 had the same shape (a separate status table) for broadcast-channel reasons; v4 keeps the shape with a better justification.

`puzzle_snapshot`: games denormalize the puzzle at creation, so a live game is self-contained. Puzzle edits or deletions cannot corrupt a game in flight, and the actor hydrates from one row plus `game_state`.

**Migrations**: Drizzle Kit, SQL committed in-repo, applied by CI. The database dashboard is read-only by policy. Fresh-clone reproducibility is a launch gate: v2 could not be rebuilt from its repo, and that failure mode is retired here.

## 10. Clients

**Shared client contract**, both platforms: render sequenced state plus an optimistic overlay keyed by `commandId`; the echo of your own event clears its overlay entry; an event that changes a visibly different value triggers a ~300 ms flash in the writer's color; a sequence gap triggers a resync; the connection state machine is identical and specified in `PROTOCOL.md`. The timer renders from `firstFillAt` and `completedAt`; clients hold no clock state.

**Web**: Vite + React SPA on static hosting. Next.js was rejected: this client is an authenticated, WebSocket-driven app, server-side rendering of it serves nobody, and the framework would add a server tier with no job (link previews, the one real SSR need, moved to the API). The SVG grid carries over from v2 with its states intact: a 36-unit cell module scaled to fit; background precedence `black square > current cell > check/cross-reference highlight > active word > teammate-here > default`; clue numbers top-left; circles as inset rings; a teammate cursor drawn as a direction arrow plus avatar or initial, collapsing to a count when several teammates share a cell. Exact pixel constants live in the frozen v2 extraction; the rules above are sufficient to rebuild the look. Mobile web ships the fix for v2's worst gap: a tappable active-clue bar opening a bottom-sheet clue browser, an on-screen keyboard driving store actions directly, swipe along the solving direction for next/previous word and across it to toggle direction.

**iOS**: native SwiftUI, floor iOS 26. The grid is a `Canvas` renderer implementing the same rules; the reducer is a small Swift port kept honest by the shared vectors in CI. Liquid Glass appears on chrome only (toolbars, clue bar, sheets, overlays); the grid surface stays solid and high-contrast for glyph legibility. WebSocket via `URLSessionWebSocketTask` running the same reconnect state machine. Sign in with Apple is native; Discord uses `ASWebAuthenticationSession`; invite links are universal links.

## 11. Testing

Stance: vectors are written before implementations; the spec is the failing test. Mock only at ports; infrastructure tests run real Postgres via Testcontainers. Test names cite the invariant they defend (`INV-n`), which makes coverage of the things that matter greppable.

| Suite               | Pins                                                                                                                                          | Tooling                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Engine vectors      | reducer, comparator, navigation semantics                                                                                                     | JSON vectors; vitest runner + XCTest runner     |
| Completion matrix   | the v3-derived edge catalog: double completion, filled-but-wrong, last-two-cells race, mid-keystroke completion, completion during disconnect | vectors + actor integration                     |
| Simulation harness  | convergence and freeze-after-completion under randomized delay, drop, reorder, disconnect, and reconnect across N simulated clients           | property-based (fast-check), seeded, replayable |
| Service integration | flush atomicity, hydrate, passivate, drain, membership-changed                                                                                | Testcontainers Postgres, real WebSockets        |
| Contract            | REST and WS schemas vs generated TS/Swift types                                                                                               | schema snapshot tests                           |
| Smoke               | two browsers solve a mini; one is killed mid-word; both converge                                                                              | Playwright, kept tiny                           |

The simulation harness is the regression fortress: every convergence bug it finds is a seed number, and every production bug is one log replay away from becoming a vector.

## 12. Invariants

- **INV-1 Determinism.** Identical event sequences produce identical states, across languages.
- **INV-2 Total order.** Events per game carry contiguous `seq` from 1; only the actor assigns `seq`.
- **INV-3 Completion is durable and unique.** Exactly one `gameCompleted` per game, persisted before broadcast.
- **INV-4 Terminal states freeze.** No board mutation after `completed` or `abandoned`.
- **INV-5 Bounded durability.** Graceful shutdown loses nothing. A hard crash loses at most the unflushed tail (bounded by the flush policy), and the restored snapshot-plus-log pair is internally consistent.
- **INV-6 Solutions never leave the server**, in any payload.
- **INV-7 Single writer per table.**
- **INV-8 The session service never mutates membership**; it verifies.
- **INV-9 Engine purity.** No IO, clock, randomness, or ambient identity inside `packages/engine`.
- **INV-10 Clients render sequenced state plus overlay only.** Overlay entries clear only on echo (`commandId` match) or on resync.

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

**D06 Native SwiftUI iOS, floor iOS 26, Liquid Glass on chrome only.** Rejected: React Native or Capacitor (would reuse the grid but blunt the native feel that motivated a native app at all). Cost: the grid renderer and reducer exist twice; vectors carry the correctness burden.

**D07 Vite React SPA for web; link previews served by the API.** Rejected: Next.js (a server tier with no job here; SSR of an authenticated WebSocket app is meaningless). Cost: one small HTML + OG endpoint on the API.

**D08 Monorepo, everything in.** Engine, protocol, api, session, web, ios, vectors, reports, docs; pnpm workspaces; macOS CI path-filtered. Rejected: split repos (kills atomic protocol + vectors + both-clients changes). Cost: macOS runner minutes on iOS-touching changes.

**D09 Guests now, as anonymous-upgradeable identities; join-only; IP rate limits.** Everything keys on `user_id`; auth method is an attribute of identity. Rejected: accounts-only (kills click-link-and-play); game-scoped pseudo-identities (break the `user_id` axiom, make upgrade bespoke). Cost: a stale-guest cleanup job; an abuse surface bounded by join-only.

**D10 Spectator role modeled now; kick via per-game denylist.** Links land as spectator; upgrading is one tap. Rejected: link rotation on kick (punishes everyone else holding the link). Cost: a denylist check at join and connect.

**D11 Server-noticed completion; solutions never leave the server; Check is a command.** The actor detects the full board, validates, emits. This deletes v2's claim endpoint, its "Verifying..." limbo dialog, and the stale-claim race, rather than fixing them. Cost: Check pays one round trip, roughly 50 ms; a deliberate button press tolerates it.

**D12 Rebus: comparator accepts full string or first character, case-insensitive; buffer input on web, inline field on iOS.** First-char is the format's own convention; v2's first-char-only was accidental, this is chosen. Cost: comparator vectors must encode both acceptances.

**D13 Puzzle ingestion is an anti-corruption layer with named rejections; 25x25 cap; clues normalized at the boundary.** Rejected: v2's silent stripping (a diagramless puzzle would ingest and render wrong). Cost: some real puzzles are refused, with a reason the user can read.

**D14 Durability window: write-behind at ~25 events or ~5 s; drain on SIGTERM; synchronous flush for terminal events.** Deploys and restarts lose nothing; a hard crash loses seconds of typing in a friendly crossword. **Adopted-by-default**: the thresholds are guesses to tune with measurement.

**D15 Timer derived from the event log; starts at first fill; no pause.** Rejected: v2's game-creation start (penalized lobby dawdling); client clocks (skew). Cost: none found.

**D16 Full event log retained; analytics UI deferred.** Replay-driven debugging now; contribution maps, heatmaps, and solve replay later as queries over data that already exists. Cost: negligible storage.

**D17 Hosting: Railway for both services; Supabase stays for Postgres + Auth; the SPA on any static host.** Asynchronous flushes make cross-provider database latency tolerable; co-locate regions. Rejected: big-cloud (infrastructure ceremony is the learning budget we agreed not to spend); a VPS now (the ops itch is deferred, not denied); Workers/Durable Objects (platform-shaped learning). **Adopted-by-default**: not load-validated; Fly.io is the named alternate; Docker images plus `DATABASE_URL` keep the exit open.

**D18 Protocol: versioned handshake; the server supports N and N-1; full-snapshot resync; commandId dedup.** N-1 exists because App Store review makes iOS and web release on different cadences. Rejected: delta sync (complexity for a board under 20 KB). Cost: the two-version tax from the first iOS release onward.

**D19 No offline in v4; events stay per-cell, versioned, string-valued.** That shape is CRDT-compatible, so a future local-first retrofit is not foreclosed. Cost: none now.

**D20 Command/event vocabulary; presence and cursors are ephemeral.** Client intents are commands; sequenced facts are events; presence never enters the log. Cost: presence is best-effort by design.

## 15. Open questions and uncertainty register

Each item names when it must close.

- Flush thresholds (25 events / 5 s) and passivation delay (30 min): guesses; measure and tune by M2.
- Railway under WebSocket load, and its pricing: validate during M1; Fly.io is the alternate; switching is about a day.
- Region placement: choose at M0 when creating the database project; co-locate the services.
- Internal service-to-service auth: a static bearer secret fits the current exposure; revisit if the surface grows.
- Client re-offer of lost commands after a crash rollback: post-v1 stretch; dedup already makes it safe.
- iOS 26 floor and Liquid Glass API details: verify against current SDKs at M5 kickoff.
- Guest IP rate-limit values and stale-guest cleanup cadence: set at M3.
- Spectator cursors: off by default; revisit if spectating feels dead.
- Digits in the value charset: kept for v2 parity; confirm no real puzzle needs punctuation.
- Rebus length cap of 10: check against real puzzles at M6.
- OG image visual parity with v2: nice-to-have, M7.
