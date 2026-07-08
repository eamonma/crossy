# v3 Mining Report — for v4 Ideation

Extraction only (no architecture proposals). Source = the abandoned v3 rewrite.
File refs use `§` for the doc's own section numbers. Verbatim quotes ≤2 lines, in
quotes, only where wording matters.

v4's decided shape (for the top-10 lens): no offline; per-game in-memory
actor/sequencer with a **pure reducer over per-cell LWW ops**; stateless core API
+ Postgres; native SwiftUI iOS + web; **guests via anonymous auth**; **friends-scope**.

---

## 1. Doc / Spec / Note Inventory

| File | Gist |
|---|---|
| `v3-architecture.md` (1953 ln) | The primary server spec: domain model, Redis-authoritative realtime, Lua CAS, SignalR protocol, PG schema, auth, deploy, testing. |
| `web-architecture.md` (1090 ln) | React web-frontend spec: screens/routing, game-play UI, Zustand+TanStack state, SignalR client, keyboard/clue/mobile UX, animation, a11y, "Lessons from v2" appendix. |
| `docs/server-devnotes.md` (386 ln) | Local dev guide: quick start, dev auth, REST/Hub reference, Redis key list, sweeper, "Known Gaps", deployment TODO. |
| `docs/xwordinfo-spec.md` (357 ln) | Puzzle data-format spec (XWord Info JSON): cell/clue/answer types, overlays, 7 puzzle variants, "Known Unknowns & Edge Cases", extension points. |
| `docs/monday.json` | Sample puzzle — real NYT Mon 2026-02-09, 15×15 — carrying the full XWord Info field set (rebus/bars/circles/uniclue flags all present). Test fixture, not a design note. |

No other notes/READMEs exist (only `.claude/settings*.json`).

---

## 2a. Product / UX Ideas Beyond Core Solving

**Post-game analytics suite** — `v3-architecture.md §5.9`; consumed in `web-architecture.md §14`.
- **Contribution map**: completed grid tinted by "which player placed the final correct letter" per cell (§5.9 Contribution Map; §14 Layout).
- **Effort heatmap**: cells colored by edit density, with 3 toggles — raw edit count (difficulty), distinct players (collaboration hotspots), incorrect attempts (error-prone areas) (§5.9 Effort Heatmap table).
- **Per-player heatmap**: where an individual focused effort (§5.9).
- **Solve replay** (flagged Future): ordered edit log "recreates the board state at any point in time" — "supports it without schema changes" (§5.9 Solve Replay).
- **Player stats card**: cells filled, total edits, first-correct cells per participant (§5.9 response `playerStats`; §14).
- **Solve summary**: solve time, total edits, conflict count, participant count (§14 Layout).
- **`dataCompleteness: full|partial`** honesty flag when events were lost (§5.9).

**Puzzle browsing / import as product surface** — `web-architecture.md §4`.
- Puzzle browser with filter by date/publisher/size/difficulty; **feature badges** (rebus, circles, mini) on cards (§4 Puzzle Browser; server user story `v3-architecture.md §2.2 Puzzle Management`).
- Import dialog with **client-side preview** (parse JSON → grid thumbnail + metadata before commit) (§4; §13 Flow 6).
- Dashboard game cards: participant avatar stack, progress (filled/total), time-since-activity, invite code (§4 Dashboard).

**Sharing / social** — `web-architecture.md §14`, `v3-architecture.md App.A.2`.
- "Share Result" (text summary or link) and "Play Again" (new game, same puzzle) post-game actions (§14 Actions).
- Deferred but designed: friends/following (`Friendship` aggregate), leaderboards ("derived from completed games, eventually consistent"), game comments, clubs/groups (`v3-architecture.md §A.2`). **Directly relevant to v4 friends-scope.**
- Spectator mode deferred: new `GameRole` (Participant vs Spectator), "receive broadcasts but cannot send updates" (`§A.3`).

**Host / creator powers** — thin in v3: only **Abandon game = creator-only** (`v3-architecture.md §7.4`, `§4.2 Commands`). No other host powers (no kick, transfer, lock). A gap v4 could expand under friends-scope.

**Constructor / puzzle-creation**: explicitly **out of scope** (`v3-architecture.md §2.3`). Import-only.

---

## 2b. Realtime Protocol / Message Designs

**Transport**: SignalR hub `/hubs/game`. `v3-architecture.md §5.4, §6.3`; client mirror `web-architecture.md §8`; `docs/server-devnotes.md` Hub table.

**Client → Server** (`§5.4`, `§6.3 IGameHub`):
| Msg | Payload |
|---|---|
| `ConnectToGame` | `gameId` — verifies participant, joins group, returns initial `BoardState`. **Does not accept invite codes.** |
| `PlaceLetter` | `cellIndex, letter, expectedVersion` |
| `RemoveLetter` | `cellIndex, expectedVersion` |
| `MoveCursor` | `cellIndex?, direction?` |
| `Heartbeat` | — |
| `RequestSync` | — (full board after reconnect) |

**Server → Client** (`§5.4`, `§6.3 IGameHubClient`):
`CellUpdated{cellIndex,value,version,playerId}` (broadcast) · `CellConflict{cellIndex,currentValue,currentVersion,currentPlayerId}` (unicast) · `BoardState{cells[],participants[],cursors[]}` · `PlayerConnected{playerId,displayName,color}` · `PlayerDisconnected{playerId}` · `CursorMoved{playerId,cellIndex,direction}` · `GameCompleted{completedAt,stats}` · `GameAbandoned{abandonedAt}` · `Error{code,message}`.

**Ordering / concurrency rules** (`v3-architecture.md §5.3`):
- **Strict compare-and-swap, not LWW.** Version must match *exactly*; both stale AND future versions return `CONFLICT` — "must match exactly (true compare-and-swap)" (§5.3 Lua). Winner determined by whichever hits Redis first; loser gets a unicast `CellConflict` and reconciles.
- Monotonic per-cell `version`, incremented on every accepted edit incl. clears (`§4.2` invariants).
- Client rule: server version is "the universal arbiter" (`web-architecture.md §20`).

**Resync flow** (`v3-architecture.md §5.7`; `web-architecture.md §8, §20`):
- On reconnect → `RequestSync` → server returns full `BoardState` from `HGETALL cells` + `ZRANGE presence` + `HGETALL cursors`; client replaces local state wholesale.
- **Full snapshot, not delta** — "The full board is <20KB. Delta sync would require… change logs, adding complexity for zero perceivable benefit" (§5.7). Client reconciles by version, then re-renders (`web-architecture.md §20`).
- If game evicted during disconnect → `GAME_NOT_ONGOING` error → client shows "no longer active" (§5.7).

**Reconnect handling** (`web-architecture.md §8, §20`; `v3-architecture.md §15.2`):
- SignalR auto-reconnect, exponential backoff `[0,1s,2s,4s,8s,16s]` (client §20) / "1s,2s,4s,8s, max 30s" (server §5.7 — **note the two docs disagree on the cap**).
- Stale detection tiers: no heartbeat-ack 30s → "unstable"; 60s → "disconnected" (`web-architecture.md §20`).

**Presence/cursor as protocol** (`v3-architecture.md §5.5`): heartbeat every 15s → `ZADD presence`; 45s timeout (3 missed) → `PlayerDisconnected`. Cursors persisted in Redis (chose "Option A") so reconnecting players see positions; throttle 10/s client + server.

---

## 2c. Completion-Flow Edge Cases (the full enumerated list)

Primary sources: `v3-architecture.md §5.3` (CompleteGame.lua + notes), `§5.6 Completion`, `§13.5` (integration test matrix), `web-architecture.md §15` (store-level).

1. **Double-completion race** — two instances/keystrokes complete the same game. Atomic `CompleteGame.lua` status check ⇒ "Exactly one returns COMPLETED, the other ALREADY_COMPLETED" (`§13.4/§13.5`, `§5.3`).
2. **Filled-but-incorrect** — grid full (`maybeComplete=1`) but answers wrong. App-side validation fails ⇒ status reset `Completed→Ongoing`; "game stays Ongoing, no state changes" (`§5.3 note`, `§5.6`, `§13.5`).
3. **TOCTOU during validation window** — while status=`Completed`, the `UpdateCell.lua` status gate rejects all edits, so no mutation can occur during answer-validation ⇒ "TOCTOU eliminated" (`§5.3`).
4. **Two players fill the last two cells simultaneously** — "maybeComplete fires (possibly twice). Exactly one completion — no duplicate GameCompleted broadcast, no duplicate PostgreSQL persist." (`§13.5`).
5. **`maybeComplete` false-trigger guard** — clear a cell then refill: fires "only on the fill that reaches" the total (`§13.3 UpdateCell.lua` cases).
6. **PostgreSQL down during persist** — game stays `Completed` in Redis; sweeper retries next pass; keys deleted only after successful persist (`§5.6`, `§13.5`, sweeper step 4 `§5.6`).
7. **Idempotent persist on crash-recovery retry** — `cell_events` UPSERT/`UNIQUE(game_id,cell_index,version)`; board snapshot UPSERT (`§5.6 consistency guarantee`, `§8.1`).
8. **Mid-keystroke completion (client)** — "GameCompleted while user is mid-keystroke — no crash, no further edits" (`web-architecture.md §15 Completion`).
9. **Completion during disconnect** — reconnect `BoardState` carries `Completed` status ⇒ client transitions to post-game (`web-architecture.md §13 Flow 5`).
10. **Reject edits after completion** — `UpdateCell.lua` returns `GAME_NOT_ONGOING` for Completed/Abandoned games (`§5.3`, `§13.3`).

**v4 note:** the reducer's op-log + single-writer sequencer collapses several of these (double-completion, TOCTOU) into "the sequencer decides once" — but 2/5/8/9 remain reducer/client concerns.

---

## 2d. Puzzle-Format Edge-Case Notes

Source: `docs/xwordinfo-spec.md` (§2, §3.2, §8, §9, §12) + `v3-architecture.md §4.1, §10.3`.

- **Rebus** — cell holds a multi-char string; "Solvers may enter only the first character and be considered correct" (`xwordinfo §3.2`). Rebus answers expanded inline in `answers` (`§3.4`, `§8.3`). Import sets `HasRebus` if any `len(Solution)>1` (`v3-architecture.md §10.3`). Client rebus input mode: see 2g.
- **Multi-word answers** — "No formal field distinguishes single-word from multi-word answers. Spaces are omitted" (`§12`). Not modeled.
- **Enumerations** — `(2,3)`, `(hyphenated)` are "embedded in clue text, not structured" (`§12`); extension point = parallel `clue_meta` (`§13`).
- **Shading / color** — `interpretcolors` + `shadecircles` flags exist but "no field defines per-cell color values… requires an extension" (`§2.1`, `§6.1`, `§12`).
- **Circles** — flat 0/1 array; when `shadecircles`, render shaded not outlined (`§6.1`).
- **Bars (barred grids)** — `rbars`/`bbars` right/bottom edges; "May have no black squares (all cells are letters)" (`§6.2`, `§8.4`).
- **Unchecked squares** — cryptic-style checked vs unchecked cells "not explicitly modeled" (`§12`).
- **Diagramless** — `type:"diagramless"`; solver doesn't see block placement initially (`§8.5`).
- **Cryptic** — `type:"cryptic"`; may have "fewer checked squares" (`§8.6`).
- **Uniclue** — `uniclue:true`; single shared clue list, direction from context (`§8.7`).
- **Non-contiguous / diagonal entries** — `acrossmap`/`downmap` give explicit index lists for "snaking or jumping entries," irregular grids (`§7`); but format "assumes across/down only" — no new direction labels (`§12 Multi-direction`).
- **Encoding** — UTF-8; `\"` escapes; `\/` in dates; HTML in `notepad`/`jnotes` (stripped on import per `v3-architecture.md §10.3`) (`§9`).
- **Not modeled**: solve-time/difficulty/par metadata; solver state (partial fills, pencil marks, timer); grid symmetry declaration (`§12`).
- **Cross-references** — "See 42-Across" detected via regex; referenced cells highlighted (`web-architecture.md §10 Cross-Reference`).
- v3's own max constraint: **25×25 / 625 cells** to keep sync payloads <20KB (`v3-architecture.md §2.4`).

---

## 2e. Schema / Data-Model Designs

**PostgreSQL** — `v3-architecture.md §8.1` (DDL), `§8.2` (JSONB), `docs/server-devnotes.md` Schema Overview.
- `players(id, external_identity_id UNIQUE, display_name, avatar_url, created_at, updated_at)`.
- `puzzles(id, idempotency_key, title, author, editor, publisher, published_date, copyright, notes, rows/columns CHECK 1–25, has_rebus/has_circles/has_bars/is_mini, grid JSONB, clues_across JSONB, clues_down JSONB, source_format, created_by FK, UNIQUE(created_by, idempotency_key))`.
- `games(id, idempotency_key, puzzle_id FK, puzzle_snapshot JSONB, board_snapshot JSONB, status, invite_code UNIQUE CHECK ~ '^[2-9A-HJ-NP-Z]{8}$', created_by, created_at, completed_at, completion_stats JSONB, UNIQUE(created_by, idempotency_key))`.
- `game_participants(game_id, player_id, joined_at, PK(game_id,player_id))` — **append-only, permanent** (`§4.2`).
- `cell_events(id BIGSERIAL, game_id FK, cell_index SMALLINT, player_id FK, value VARCHAR(10), version INT, occurred_at, UNIQUE(game_id,cell_index,version))` — **the append-only op log**, populated at completion/eviction; powers all analytics.

**Domain aggregates** — `v3-architecture.md §4`.
- **Puzzle** (immutable): grid `CellDefinition[]{index,type,gridNumber?,isCircled,solution,rightBar,bottomBar}`, `ClueSet{Across,Down: Clue{number,text,answer,cellIndices[]}}`, `PuzzleFeatures{HasRebus,HasCircles,HasBars,IsMini}` (§4.1).
- **Game**: `PuzzleSnapshot{Dimensions,CellLayout[],Solutions[],Circles[],ClueCount}` (denormalized at creation — self-contained, no cross-aggregate reads for completion, `§4.2 Snapshot Rationale`); `Board: Cell[]{index,value?,version,lastUpdatedBy?}`; `Participants: Set`; `Status: Ongoing|Completed|Abandoned`; `CompletionStats{solveTimeSeconds,totalCellUpdates,participantCount}`.
- **Player**: `{id, externalIdentityId, displayName, avatarUrl?}`.
- Your memory adds: `PuzzleSnapshot` extended with Title/Publisher/PublishedDate/GridNumbers/CluesAcross/CluesDown; `ClueEntry(Number,Text,CellIndices)` "safe projection that omits Answer"; `ParticipantDto` includes `AvatarUrl`.

**Redis (in-memory authoritative)** — `v3-architecture.md §5.2`, `docs/server-devnotes.md` Redis Keys.
- `game:{id}:cells` Hash `{v,n,p}` per index · `:meta` Hash (status, puzzleId, lastActivity, `filledCount`, `totalLetterCells`, completedAt) · `:history` List (capped 10k) · `:presence` ZSet (score=heartbeat) · `:cursors` Hash · `:participants` Set · `:layout` String · `games:activity` ZSet · `sweeper:lock` String.
- Cell-event Redis JSON uses **short keys** `{c,p,v,n,t}` to cut memory; PG uses full names (`§8.2`).
- Memory sizing: ~50–180KB/game; ~33K concurrent games at 6GB; history is dominant cost (`§5.2`).

---

## 2f. Testing Plans / Strategies

**Server** — `v3-architecture.md §13`; `docs/server-devnotes.md` Running Tests.
- Guiding principle: "Test where the risk is, not where it's easy" — real Redis+PG via Testcontainers, **no mocking Redis/PG** (§13.1, §13.9). Mock only at Application boundary (`IGameStateStore`, `ICellEventRepository`, `IEventPublisher`).
- Highest-priority: **Lua script tests** (CAS correct/stale/future version, clear-empty, filledCount accuracy, maybeComplete true/false-trigger, history cap at 10k, rebus, cjson empty-string round-trip, reject-on-Completed) (`§13.3`).
- **Sweeper integration** (basic eviction, crash recovery/idempotency, lease contention, stale threshold 25h vs 23h, heartbeat-prevents-eviction, cross-check false-eviction, stuck-completed retry) (`§13.4`).
- **Completion flow** (the 2c matrix) (`§13.5`).
- Domain unit (invariants, state machine, invite-code format), App unit (handler orchestration/idempotency), API/SignalR full-stack via `WebApplicationFactory` (`§13.6–13.8`).
- CI: containers from day one; Docker unavailable ⇒ build "unstable, not green" (§13.1, §13.10). Target <75s. Actual counts (`server-devnotes.md`): Domain ~65, App ~58, Infra ~70, Api ~33, Smoke 11.
- **Smoke tests**: standalone black-box project, no solution refs, HttpClient + SignalR client against live server (`server-devnotes.md` Smoke Tests).

**Web** — `web-architecture.md §15`.
- "Test the logic, not the components." Vitest on pure `lib/` + Zustand store + SignalR-protocol (mock connection); Playwright for flows; **skip component-render tests** (§15).
- **Real-time edge-case suite** (highest value): optimistic cycle, board-sync with pending edits, conflict-after-move / conflict-on-re-edited-cell, disconnect mid-PlaceLetter, rapid disconnect/reconnect, **out-of-order** (`CellUpdated v5 before v4`; `BoardState between send and response`), mid-keystroke completion (§15 table).

---

## 2g. Timer, Mobile UX, Auth/Guest

**Timer** — `web-architecture.md §5`.
- Toolbar timer = "elapsed since game **creation**" (not per-session) (§5 Desktop/Mobile Layout). `CompletionStats.SolveTimeSeconds` recorded on completion (`v3-architecture.md §4.2`).
- Format note: `tabular-nums` on all changing numbers to prevent layout shift (`web-architecture.md §2 Typography`).
- Puzzle format has **no** par/difficulty/timer fields (`xwordinfo §12`).

**Mobile UX** — `web-architecture.md §5 Mobile Layout, §10 Mobile Clue Sheet`.
- v2's "biggest weakness: clues were completely inaccessible on mobile" → **tappable active clue bar → bottom sheet** clue browser, Across/Down tabs, tap-to-navigate-and-dismiss (§5, §10, App.A "Clues invisible on mobile").
- On-screen keyboard (`react-simple-keyboard`) dispatches direct store actions, not synthetic DOM events (§9).
- Grid sizing: max `68svh` phone / `75svh` tablet (§5). Optional swipe gestures: swipe-in-direction = word nav, swipe-perpendicular = toggle (§9).
- Per-cell re-render isolation (only cell 42 re-renders when cell 42 changes) (§6).
- **Rebus input mode** (`web-architecture.md §22`): toggle `Esc`/button; keystrokes append to `rebusBuffer`; `Enter` commits via `PlaceLetter`; `Escape` cancels; "REBUS" badge + cell-border highlight.
- Accessibility (`§23`): `role=grid/gridcell` ARIA, computed cell labels ("14 across, 1 down. Letter A"), `aria-live=polite` LiveAnnouncer for conflict/completion/join/reconnect.

**Auth / guest** — `v3-architecture.md §7`; `web-architecture.md §12, §24`; `server-devnotes.md` Authentication.
- Prod: **Entra External ID native auth** (email OTP + Google/Apple), custom-branded, no redirects. OTP config: 10-min expiry, 6 digits, 5 max attempts, 15-min lockout, single-use (`§7.3`).
- Tokens in memory (not localStorage); proactive refresh when <5min to expiry, incl. SignalR `accessTokenFactory` (`web-architecture.md §12, §24`).
- **Dev auth**: `X-Dev-Player-Id` header + `?access_token={guid}` query fallback for WS upgrade; auto-creates player on first `/players/me` (`§7.6`, `server-devnotes.md`).
- **Authz split** worth keeping: becoming a participant is REST-only (`POST /games/{id}/join` w/ invite code); the hub only *verifies* existing membership, never accepts codes (`§6.3`, `§7.5`).
- **No guest/anonymous auth in v3** — every action requires an authenticated account. v4's anonymous-guest model is net-new; v3's dev-mode "GUID = identity, auto-create" is the closest existing seed pattern.

---

## 3. Contradictions / Tensions vs. the Summary
("v3 = .NET + Redis Lua CAS + SignalR, deferred offline, accepted Redis loss")

The summary is broadly accurate. Nuances to flag:

1. **"Accepted Redis loss" is narrowly scoped, not blanket.** v3 works hard to *avoid* loss: **no TTLs** ("eliminates the data-loss risk of TTL-based eviction," `§5.6`), AOF for sub-second durability, one-way persist-then-delete with sweeper crash-recovery. Loss is accepted *only* for **in-progress games on catastrophic AOF loss** — completed/evicted games are durably in PG (`§5.8`, `§5.9`). Don't read it as "v3 casually drops data."
2. **CAS ≠ LWW — and v3 explicitly rejected LWW.** Summary says "Lua CAS"; correct. But note the design lesson: v2's "No concurrency control (last-write-wins) → Silent data loss" was deliberately replaced by version-checked OCC + visible conflict UI (`web-architecture.md App.A`). v4's per-cell **LWW** ops (via a single-writer sequencer) is a *different* mechanism, but the v3 authors' warning about client-visible LWW is directly on-point and should be read before finalizing v4 conflict semantics.
3. **v3 is implemented, not merely spec'd.** `server-devnotes.md` "Known Gaps: No remaining gaps"; ~237 server tests + 11 smoke; new `HubDtos.cs`/`ArchitectureGapRegressionTests`. Treat v3 as a working reference implementation to lift code/tests from, not a paper design.
4. **Implementation drifted slightly past the spec's stated Redis model.** `server-devnotes.md` lists `game:{id}:participants` (Set) and `game:{id}:layout` (String) keys **absent from `v3-architecture.md §5.2`**; your memory confirms these were added for join/validation. Minor, but the spec's §5.2 is not the final word.
5. **Broadcast-vs-persist ordering diverged.** Spec §5.6 completion persists (step c) *before* broadcasting (step d); but memory records "AbandonGameHandler: broadcast BEFORE persist (race condition fix)," matching §5.6's *abandon* path. The two lifecycle endings order these differently — worth confirming which v4 wants.
6. **Reconnect backoff cap conflicts between docs** — server §5.7 "max 30s" vs web §20 `[…8000,16000]` (16s cap). Trivial, but a real doc inconsistency.

None of these overturn the summary; they refine it.

---

## 4. Ranked Top-10 to Carry Into v4

Given v4 = reducer over an ordered op-log + per-game actor/sequencer + Postgres + SwiftUI/web + guests + friends-scope:

1. **`cell_events` append-only op-log + the whole analytics suite.** v4's sequencer *emits this for free*; contribution map, effort heatmap, per-player stats, and solve-replay become near-zero-cost features that are genuine product differentiators. (`§5.9`, `§8.1`, `web §14`)
2. **The completion-flow edge-case catalog (2c).** A ready-made reducer spec + test matrix — double-completion, filled-but-incorrect reset, last-two-cells race, mid-keystroke completion, completion-during-disconnect. These are the exact invariants v4's reducer must satisfy.
3. **`maybeComplete` two-phase completion** — cheap `filledCount==total` gate, then authoritative answer validation, then commit. Maps cleanly onto a reducer (track filled count) + actor (validate/commit once), and avoids validating on every keystroke.
4. **PuzzleSnapshot denormalization at game creation.** Immutable, self-contained games with no cross-aggregate reads for completion — ideal for spinning up an isolated per-game actor and for durable historical records. (`§4.2`)
5. **Full-snapshot resync on reconnect (`RequestSync`→`BoardState`, <20KB, no delta).** Simple, proven, and exactly how an in-memory actor should rehydrate a reconnecting client. Skip delta-sync complexity. (`§5.7`)
6. **The message vocabulary** (`PlaceLetter/RemoveLetter/MoveCursor/Heartbeat/RequestSync` ↔ `CellUpdated/BoardState/PlayerConnected/CursorMoved/GameCompleted/GameAbandoned/Error`). ~90% reusable as v4's op/event set; in an LWW-sequencer model `CellConflict` likely drops out — a simplification, not a loss. (`§5.4`)
7. **Mobile clue UX: tappable clue bar → bottom-sheet browser.** Solves v2's flagged worst failure ("clues invisible on mobile"); translates directly to a SwiftUI sheet + the primary web mobile pattern. (`web §5, §10`)
8. **Invite-code design + REST-join-then-connect authz split.** Unambiguous 31-char alphabet, crypto RNG, rate-limited lookups; membership mutation via REST, hub only verifies. Clean fit for friends-scope + guest joins. (`§6.2`, `§7.5`, `§14.3`)
9. **Presence/heartbeat/cursor model + deterministic per-player colors.** Heartbeat→ZSet, 45s timeout, cursor throttle 10/s, FNV-1a color hash — an actor holds all of this in memory trivially; colors stay consistent across reconnects and clients. (`§5.5`, `web §21`)
10. **XWord Info import mapping + the puzzle-format edge-case catalog (2d).** De-risks the importer and forces early data-model decisions on rebus/enumerations/unchecked/shading before they become migrations. (`§10.3`, `xwordinfo §8, §12`)

**Honorable mentions** (strong, just below the line): the "test the boundary, not the component / no-mock-infra" testing philosophy (§13, web §15); idempotency-key pattern on creates (§6.2); three-tier error taxonomy — ambient/informational/terminal (web §18); rebus input mode (web §22); a11y grid + LiveAnnouncer (web §23).
