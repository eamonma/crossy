---
status: descriptive
---

# The room actions control (check puzzle, end game, party)

Status: design, revised after adversarial review, ready to build. Branch
`feat/room-check` (service leg landed, draft PR #264; this doc governs the UI waves
that follow on it).
Author: DESIGN. Precedence: `vectors/` > `PROTOCOL.md` > `DESIGN.md` > this doc > any
implementation.

## 0. Post-review revisions (authoritative; overrides the sections below where they conflict)

An adversarial review (2026-07-16) verified every factual claim against the code. The
architecture held; three High defects and a round of Mediums did not. These resolutions
are authoritative. Where a later section conflicts, this section wins.

**R1 (was High). Wave 2 gains the whole iOS store leg; "GameStore already ingests
`puzzleChecked`" was false in every sense that matters.** `GameStore.swift:410` advances
the seq gate and drops the payload; the store holds no mark state; `applySnapshot` never
reads `board.checkedWrongCells`/`checkCount`; `applyCellSet` has no clearing rule; no
`checkPuzzle` send intent exists. Wave 2 now includes, mirrored from the web store
(`gameStore.ts`): `checkedWrong`/`checkCount` state, snapshot healing on
resync/reconnect, `puzzleChecked` application under the seq gate, the §10 clearing rule
in `applyCellSet`, and the send intent.

**R2 (was High). The send and rejection path, designed, both platforms.** Neither store
has an outbound `checkPuzzle` intent; each wave adds one (commandId-minted, the existing
intent register). The confirm-time race — a teammate empties a cell between render and
confirm — resolves in layers: the dialog's confirm action re-derives fullness from
sequenced state at tap and quietly falls back to the disabled row when stale; if the
server still rejects (`GRID_NOT_FULL`), the client does nothing beyond its
already-updated state — the newly empty cell and the row's remaining-cells hint are the
explanation. No toast, no error modal; the rejection is non-fatal and the room's own
state shows why. Implementation note: the web store's rejection handler only clears
optimistic overlay entries today; the `checkPuzzle` path must not assume an overlay
entry exists for its commandId.

**R3 (was High; owner ruling 2026-07-16). Party mode moves to the Share popover; the
room-actions popover is check and end-game only.** The review found party's actual home
— the AppShell UserCard menu, available on any game route including completed rooms,
where the projector shows the finished mosaic on a TV. Party is a display toggle, not an
act on the game state, so it never belonged on the room-actions surface; the owner ruled
it out of the UserCard too. Its home is Share — putting the room on a TV is the room's
reach, §2's own definition. The Share popover gains the party row (all statuses, so the
completed-mosaic projector stays reachable), the UserCard entry is removed, and §2's
table and §3/§5 lose their room-actions party rows; iOS remains without party mode.

**R4 (was Medium). Terminal means terminal, not completed.** The toolbar's only status
input today is `done = status === "completed"` (`LiveApp.tsx:1242`); an abandoned room
reads as not-done, which would leave check and end-game rendered where the server
answers `GAME_NOT_ONGOING`. Wave 1 plumbs `store.status`; the popover renders only for
`ongoing`.

**R5 (was Medium). The marks are the check fill, not a slash.** Both platforms already
scaffolded the background register for exactly these marks: iOS `CellFill.check`
(`GridFill.swift`, declared this branch and slotted into the pinned fill precedence) and
the web's `wrong` cell role feeding DESIGN.md §14's "check" precedence level. §6's
diagonal-slash idiom is struck; the mark renders as the check fill in each platform's
grid tokens. This is also why DESIGN.md now appears in the precedence line above: the
original doc omitted it and contradicted its grid law without noticing.

**R6 (was Medium). Overlay suppression, quoted.** PROTOCOL §10: a cell with a pending
optimistic overlay entry renders the overlay, not the mark. §6's "the client never
clears marks locally" is bounded by that rule — suppressing the fill under a pending
overlay is display, not clearing.

**R7 (was Medium). Sheet height slots, honestly counted.** `RoomFactsSheetLayout.height`
is pinned slot arithmetic; §4's "extends by one operation row" undercounts and would
clip. The formula gains two conditional additions: the checked-count facts line (its own
gap + height slot) and the check operation row; the remaining-cells hint renders inside
the row's standard height at the trailing edge, no extra slot.

**R8 (was Medium). The demo gates the row, not just the command.** The demo drives the
real SolveScreen and facts sheet, and its mini is fillable-but-wrong; ungated, the row
would enable and confirm into a void (`DemoRoom` drops `checkPuzzle`). The operations
derivation excludes check when there is no live transport. Web is safe structurally —
the room-actions wiring threads from LiveApp only, the RoomAdmin pattern.

**R9 (Low, pinned). Grid-full derives from sequenced state only**, matching the server's
own gate. A just-typed optimistic last letter leaves the row disabled for a beat;
accepted on both platforms so they cannot diverge.

**R10 (Low, pinned). The count's homes.** Mid-solve: the iOS facts line (§4) and, for
parity, the same quiet "Checked N times" line on the web popover's check row. After
completion the record freezes into `stats.checkCount` and its display home is a future
facts row on the analysis surface — deferred deliberately, named so it does not read as
an oversight.

**R11 (Low). The web trigger sits immediately left of Share**, after the theme toggle —
the two room popovers adjacent, the personal toggle outside them.

## 1. Problem

The room check (PROTOCOL.md §10, D27) arrives with no home. The acts that already exist
are scattered: on web, the host's end-game is a destructive row inside the _Share_
popover, next to invite links it has nothing to do with; on iOS it is the operations
block of the RoomFactsSheet; the party projector toggle is web-only and homeless. Each
new room act would invent its own chrome.

## 2. The organizing principle

A room has exactly three action surfaces, split by what the act operates on:

| Surface      | Operates on      | Today                                    |
| ------------ | ---------------- | ---------------------------------------- |
| Share        | the room's reach | invite code, QR, short link              |
| Roster       | the people       | host kick, presence                      |
| Room actions | the game         | new: check puzzle, end game, party (web) |

Share grows the room. Roster manages who is in it. Room actions act on the puzzle state
everyone shares. End-game migrates out of Share on web; it was always a room action.

## 3. Contents

- **Check puzzle** — any host or solver, once the grid is full (PROTOCOL §5). Marks every
  comparator failure for everyone; the count is permanent (D27).
- **End game** — host only, the existing abandon. Unchanged semantics, new home on web.
- **Party mode** — web only, the existing `?party=1` projector toggle. iOS has no party
  mode and gets no placeholder.

Future occupants (a reveal act, pencil mode, pause) join this surface when they exist.
None are designed here.

## 4. Placement: iOS

The RoomFactsSheet _is_ the control. It already has the right bones: opens from the time
pill mid-solve only (SolveScreen gates `openFacts` to ongoing, which matches the check's
GAME_NOT_ONGOING gate for free), already carries an operations block under a hairline,
already owns the one-confirm precedent (the end-game `confirmationDialog`).

- **Check puzzle** becomes an operation row above end-game. Visible to hosts and solvers
  (spectators never see it; the server enforces the role gate regardless). Enabled only
  when the grid is full; below full it renders disabled with a quiet remaining-cells
  hint, so the row teaches the gate instead of erroring into it.
- **Confirmation** is a system `confirmationDialog`, the end-game register exactly:
  title "Check the puzzle for everyone?", action "Check puzzle", cancel "Keep solving".
  Not destructive, so no red; the plain tint. One confirm, plainly worded.
- **Facts**: once `checkCount > 0`, the sheet's facts gain a quiet line ("Checked once" /
  "Checked N times"). Neutral record, no attribution, matching the wire event's missing
  `by` (D27).
- No new chrome, no new morphs. The sheet's height formula extends by one operation row.

## 5. Placement: web

The GameToolbar grows a room-actions popover (the register of the existing Share and
roster popovers), trigger sited between the avatar stack and Share.

- Rows: **Check puzzle** (gated as on iOS: hidden from spectators, disabled below a full
  grid with the remaining-cells hint), **Party mode** (the existing `togglePartyHref`
  navigation), and host-only under a separator, **End game** (moved from the Share
  popover; Share keeps only invite concerns).
- **Confirmation** reuses the end-game Dialog register: same component, non-destructive
  styling, "Check the puzzle for everyone?" / "Check puzzle" / "Keep solving".
- The popover renders only while the game is ongoing (the toolbar already knows terminal
  state; the Done chip precedent).

## 6. The marks

`puzzleChecked.wrongCells` and the snapshot's `checkedWrongCells` render as a shared,
live mark on each listed cell, on both platforms and the party projector.

- The idiom is the crossword-native one: a diagonal slash through the cell's glyph, drawn
  in the grid's error register, identical for every member (the marks are room state, not
  personal state). Exact stroke, weight, and color resolve against each platform's grid
  tokens in the wave; the web rendering is not a visual spec for iOS.
- Marks clear only when the engine clears them (a value change on the cell, PROTOCOL
  §10). The client renders state; it never times marks out or clears them locally.
- At completion zero marks stand (guaranteed by §10), so terminal surfaces need no
  mark-clearing logic; the mosaic and analysis surfaces are untouched by this wave.

## 7. Non-goals

- No vote, no per-user check, no reveal of correct answers (INV-6: `wrongCells` are
  indices only).
- No scoring or achievement consumption of `checkCount`; the count is durable and waits.
- No demo-room check: DemoRoom ignores `checkPuzzle` today and keeps doing so; the demo
  teaches filling, not checking. Revisit only if the demo grows a full-grid moment.
- No Android; the port branch picks this doc up on its own schedule.

## 8. Waves

1. **Web** — room-actions popover, confirmation, mark rendering, end-game migration out
   of Share, party row. Store work already landed with the service leg.
2. **iOS** — RoomFactsSheet operation row + confirmation, facts line, grid mark
   rendering (GameStore already ingests `puzzleChecked`; this wave consumes it).

Each wave is one PR-sized commit series on `feat/room-check`; the branch merges once
both land and the owner has seen the surfaces on device.
