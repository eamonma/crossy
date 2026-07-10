# Crossy iOS Experience

Status: draft 1, for owner review. Date: 2026-07-09.
Companion: `apps/ios/DESIGN.md` (look and feel, materials, motion).

**Scope and precedence.** This document owns the iPhone app's product vision, flows,
screens, states, and copy voice. It owns no semantics: wire behavior, navigation
rules, and store reconciliation are owned by `PROTOCOL.md` and `vectors/`; roles,
identity, and architecture by the root `DESIGN.md`. Where a flow below touches an
endpoint or message, the citation is the authority, not the prose here.

## 1. What the iOS app is

The web client is where you land from a link. The iOS app is where the ritual lives:
the same few friends, the evening call, the room in your pocket. Its job is to make
the recurring solve feel native and inevitable: haptics under your fingers, the room
following you out through the Dynamic Island, an invite that unfurls in the group
chat and opens straight into the app.

**v1 scope** (owner decisions, 2026-07-09): iPhone first. Named accounts only;
Discord OAuth via Supabase; no guest sign-in (guests are a web-only spectate
feature). More sign-in options come later, Sign in with Apple and passkeys among
them, deliberately unrushed. iOS 18 floor (owner ruling 2026-07-10, amending root
DESIGN.md D06): the full glass chrome needs iOS 26; 18 through 25 gets the same
layout on a simple blur material (apps/ios/DESIGN.md section 4). Nothing here races
a deadline.

**Non-goals for v1**, recorded so nobody quietly builds them: iPad-optimized layout,
offline solving, widgets beyond the Live Activity, puzzle construction or discovery,
analytics UI, Android (root DESIGN.md section 1 non-goals apply wholesale).

## 2. The journey

Seven moments, in order. Each is grounded in surface that already exists in
production.

1. **First open.** No tour, no carousel. The wordmark types itself into a few cells,
   one line says what this is, one button continues with Discord.
2. **Sign in.** `ASWebAuthenticationSession` to Discord through Supabase. The sheet
   is the system's; the frame behind it stays quiet. Tokens live in the Keychain.
3. **Rooms.** Home is the rooms you belong to (`GET /games`): the grid's geometry as
   a fingerprint, the people as dots, the puzzle title. Cards sell people, not
   progress; the endpoint deliberately carries no lifecycle status (PROTOCOL.md
   section 12), and when the Archive read grant lands a status chip is an additive
   change.
4. **Bring a puzzle.** Paste a URL or open a file; XWord Info JSON (`POST
/puzzles`). Rejections arrive named (PROTOCOL.md section 12), so the copy tells
   the truth instead of apologizing.
5. **The invite.** Create a game (`POST /games`), get the code: eight characters
   from an alphabet built to be read aloud on a call. Share via the system sheet;
   `/g/{code}` unfurls server-side and opens as a universal link.
6. **Walk in solving.** A link or code seats a full account as a solver at once
   (`POST /games/join` or `/{id}/join`; owner decision 2026-07-10), so the room
   opens live with the first letter one tap away. Spectating is the guest posture,
   and guests are web-only: an iOS joiner never waits.
7. **The room, and the mosaic.** The solve is the product (section 3). Completion is
   server-noticed, exactly once; the timer freezes and the mosaic plays
   (`gameCompleted`, INV-3).

## 3. Screens

### Welcome

Cold open for the signed-out. One screen: wordmark, one line, Continue with Discord.
When launched from an invite link while signed out, the join context is held and
honored after auth completes. Auth failure returns here with a plain retry, never a
dead end.

### Rooms (home)

The signed-in root. Room cards from `GET /games` (cursor-paginated, newest first):
geometry fingerprint, member dots, puzzle title, optional game name. Two standing
actions: New game, Join with a code (glass cluster, merges on scroll). Empty state
is an invitation, not a void: one line and the same two actions. A puzzles shelf
(`GET /puzzles`) backs game creation and is reachable here.

### Create a game

Pick a puzzle from your uploads or bring one (paste URL / Files picker). Optional
name, 80 chars trimmed (PROTOCOL.md section 12). Creation returns the invite code;
the share card is the immediate next beat, share sheet one tap away. Ingestion
failures read as named, human sentences (section 5).

### Join with a code

One field, the read-aloud alphabet, autocapitalized, ambiguity-free. `POST
/games/join` resolves the code alone; `GAME_NOT_FOUND` reads "That code doesn't
match any room." `DENIED` (kicked) is honest and final. Success lands a full
account in the room as a solver (owner decision 2026-07-10).

### The room (solve screen)

The stack: room bar / grid / clue bar / key deck (layout and materials in
`apps/ios/DESIGN.md`). Connect on entry: `GET /games/{id}` for the solution-stripped
puzzle, membership, and session endpoint, then the WebSocket handshake
(PROTOCOL.md section 2).

States, each honest and distinct:

- **Solving.** The standard landing: full accounts seat as solvers on join.
  Typing through the custom key deck (never the system keyboard):
  optimistic overlay, echo clears it (INV-10). Navigation follows the vectored
  rules; swipe along the solving direction is next/previous word, across it toggles
  (root DESIGN.md section 5). Tap the clue bar or pull it up for the clue browser.
  Check is a deliberate action (`checkRequest`), wrong cells render in check style
  until next edit. Rebus entry via the bubble (D12). Conflicts are the 300 ms flash,
  nothing silent (D02).
- **Watching (spectator).** An edge on iOS, not the landing: full accounts seat as
  solvers, so this state serves the rare full-account spectator (a seat predating
  the 2026-07-10 seating change, or a future role change), and because the
  protocol allows it the client renders it honestly: the full live room,
  read-only, one affordance, Join in (`POST /games/{id}/role`). Spectator
  cursors are neither rendered nor broadcast by default (root DESIGN.md
  section 15).
- **Resyncing / reconnecting.** The three-state weather (PROTOCOL.md section 7)
  rendered as described in `DESIGN.md` section 8: calm dot, breathing dot, dimmed
  room with countdown. Input during reconnect is held gracefully, not swallowed
  silently: the overlay and reconciliation rules of PROTOCOL.md section 8 govern.
- **Completed.** The mosaic plays and the stats arrive with it (owner ruling
  2026-07-10): the frozen time, entries, solvers (`gameCompleted.stats`). The
  connection stays open; the room becomes a finished object you can revisit
  from Rooms.
- **Abandoned.** Terminal and quiet: the board freezes with a one-line notice.
- **Kicked.** `kicked` notice then close: the room exits with one honest sentence;
  the code is dead for this account thereafter (denylist).

### Roster sheet

Morphs from the room-bar pucks: everyone in the room with color, name, role, and
connection state; the invite capsule (members only, any role, PROTOCOL.md
section 12). Host powers live here: kick (`DELETE /games/{id}/members/{userId}`,
never themselves) and abandon (`POST /games/{id}/abandon`, one confirm, plainly
worded). A spectator's one action here is Join in.

### Clue browser

The clue bar, stretched: both directions, current word pinned, filled words quietly
de-emphasized, tap to jump. Cross-referenced clues link both ways ("See 17-Across"
navigates).

### Account

Minimal: identity as Discord presents it, your roster color, sign out, and account
deletion (`DELETE /account`, root DESIGN.md section 8 tombstone semantics, worded
plainly with its consequences). Display-name editing has no API surface today; see
section 7.

## 4. System behaviors

- **Universal links.** `/g/{code}` opens the app when installed (associated
  domains against the API host serving `GET /g/{code}`); the web shell remains the
  fallback for everyone else. Signed-out deep links hold their context through auth.
- **Socket lifecycle.** `URLSessionWebSocketTask` running the shared reconnect state
  machine, backoff and jitter per PROTOCOL.md section 7. Backgrounding closes the
  socket after a grace period and condenses the room to the island; foregrounding
  reconnects via fresh `hello` (scenePhase-driven). Heartbeat every 15 s while
  active.
- **The Live Activity**, staged honestly:
  - v1: started on backgrounding an ongoing room. The shared timer renders natively
    from `firstFillAt` (zero updates, survives app death, D15); board state is
    last-known.
  - later: ActivityKit push updates from the session service (fill progress,
    presence line, the away-completion moment). New infrastructure: APNs key
    (owner-held secret) and per-activity push tokens; scoped as its own track in the
    roadmap, touching the session service.
- **Store conformance.** The iOS store passes the shared client-store vectors in
  XCTest (overlay reconciliation, gap-to-sync, crash rollback), exactly as the
  engine port passes the engine vectors. This is the drift fence; the UI renders
  sequenced state plus overlay and nothing else (INV-10).
- **Errors.** Every surfaced error keys on the stable code (REST vocabulary,
  PROTOCOL.md section 12; WS codes, section 11), mapped to one human sentence each.
  No raw codes on screen, no prose keyed on message text.

## 5. Copy voice

Plain and warm (ID-5, owner ruling 2026-07-10): common words, controls that say
what happens, no metaphors on controls, nothing precious. Errors say what went
wrong and what to do, without apology. The API speaks in roles; the app does not
have to.

Lexicon:

| surface            | word                                                           |
| ------------------ | -------------------------------------------------------------- |
| home               | Rooms                                                          |
| spectator state    | Watching                                                       |
| role upgrade       | Join in                                                        |
| completion         | Solved together                                                |
| invite share       | Anyone with this code can join                                 |
| join failure       | That code doesn't match any room                               |
| kicked             | The host removed you from this room                            |
| abandoned          | The host ended this game                                       |
| diagramless reject | Crossy doesn't support diagramless puzzles.                    |
| oversize reject    | This grid is larger than 25x25, Crossy's limit.                |
| unsolvable reject  | A cell in this puzzle can't be typed, so Crossy can't take it. |

Rejection copy above is voice guidance, one sentence per named code; the codes
themselves are the contract (PROTOCOL.md section 12).

## 6. Launch cut

**v1 blocking:** auth and Keychain session; Rooms with both list endpoints; create,
ingest, share; join by code and universal link; the full solve room (watching,
solving, weather, completed, abandoned, kicked); presence and conflict flash; check;
rebus entry (a plain inline field qualifies; the bubble theater does not gate
launch); clue browser; the mosaic in a simple form (tint, hold, settle); pan and
zoom to the 25x25 cap; account with deletion.

**Follow-on:** Live Activity pushes and the away-completion moment; presence glints;
the clarity beat; mosaic choreography; pan-thinning chrome; App Store screenshot
pass. Auth breadth (Sign in with Apple, passkeys) is owner-gated and deliberately
unscheduled; it gates public App Store release, not the TestFlight v1
(`apps/ios/ROADMAP.md`, distribution note).

## 7. Open questions (owner review)

- **Display name.** The `users` mirror carries a display name from the provider,
  and no endpoint edits it today. Ship v1 with Discord-derived names, or add a
  small API surface first? Leaning ship-as-is for v1.
- **Leaving a room.** No self-leave endpoint exists; membership rows are removed
  only by kick or deletion. v1 answer: rooms simply persist in your list. If leaving
  matters, that is an API-side conversation, not an iOS workaround.
- **Live Activity staging.** Confirm the v1/later split in section 4 before the
  roadmap fences the push-infrastructure track.
