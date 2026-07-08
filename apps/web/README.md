# apps/web

The Vite + React SPA. As of **Wave 2.1d** this is the web client skeleton: the real
game store (sequenced state plus optimistic overlay, INV-10), the WebSocket codec
and transport, and grid input driven entirely by `@crossy/engine`'s navigation ops,
built per the desktop interaction spec (ROADMAP "Wave 2.1d desktop interaction
spec"). The demo boards still run on fake, local data: a tiny in-memory session
(`src/demo/fakeSession.ts`) stands in for `apps/session` behind the store's
transport port, so every interaction exercises the same code paths a live socket
will drive in Wave 2.2.

## Run it

```
pnpm install
pnpm --filter @crossy/web dev
```

Open the printed URL. Click any cell to focus the grid, then use the keyboard.

Other scripts: `pnpm --filter @crossy/web test` (the client-store vector suite plus
unit tests), `pnpm --filter @crossy/web build`, `pnpm --filter @crossy/web typecheck`.

## Layout

- `src/store/` - `GameStore`: sequenced cells, the INV-10 overlay, the three
  connection states (`live`, `resyncing`, `reconnecting`), snapshot reconciliation.
  Speaks wire types through an injected transport. Its specification is
  `vectors/v1/client-store/`; `client-store.vectors.test.ts` discovers and executes
  every case against the real store, decoding server stimuli through
  `@crossy/protocol`'s codec.
- `src/net/` - the thin WebSocket transport: hello, heartbeat, codec decode, and the
  PROTOCOL section 7 reconnect backoff (0, 1, 2, 4, 8, 16, 30 s capped, full jitter,
  reset after a 30 s survival), unit-tested in `backoff.test.ts`. `connectToGame` is
  the dev-mode connect path; no test requires it.
- `src/input/` - the spec's keyboard map and pointer paths as pure transforms, every
  cursor move through the engine ops (`getNextCell`, `wordBounds`, `tabTarget`,
  `typingAdvance`, `backspaceTarget`).
- `src/demo/` - the fake session driving the store on the demo boards.
- `src/ui/`, `src/domain/` - the SVG grid (DESIGN section 10 constants), fake board
  fixtures, and derived numbering.

## Scripted taste tour

1. **Type a word.** On the `5x4 vector fixture`, click cell 0 and type. Letters
   place through the store (a pending overlay entry renders identically to a
   confirmed fill, Decision 2.1d-4; the fake session echoes after 150 ms) and the
   cursor advances with filled-skip, wrapping to the word's first empty cell at the
   end of an incomplete word.
2. **Feel the keyboard map.** Arrows move along the axis with block-skip and toggle
   it across. `Tab` and `Shift+Tab` jump clues symmetrically, landing on the first
   empty cell, never crossing axes. `Backspace` or `Delete` clears in place, or
   steps back across a block into the previous word when the cell is already empty.
   `Space` clears the current cell and advances exactly one cell within the word,
   clamping at the word end; it never toggles direction (Decision 2.1d-5, pinned by
   `vectors/v1/navigation/space-clear-advance.json`). `Enter` and `Escape` do
   nothing.
3. **Pointer paths.** Click another cell: the cursor moves, direction stays. Click
   the current cell: direction toggles. Click the clue-bar tag: jump to the clue's
   start, no first-empty scan.
4. **Conflict flash.** Put the cursor on a filled cell and press "Teammate
   scribble": the cell flips and flashes the writer's presence color, fading over
   300 ms ease-out (Decision 2.1d-1). Scribbling an empty cell fills it without a
   flash: the trigger is a change to a value you were rendering.
5. **Connection states.** "Lose an event" delivers a cellSet with a skipped seq:
   the store requests a sync and the "Resyncing..." pill shows until the snapshot
   lands. "Drop connection" shows "Reconnecting..." and then reconciles a fresh
   welcome; letters typed while down stay pending in the overlay and re-send on
   reconnect (PROTOCOL sections 7 and 8). The grid stays navigable throughout
   (Decision 2.1d-3).
6. **Terminal freeze.** "Complete game" emits `gameCompleted`. Typing, `Space`,
   `Backspace`, and `Delete` are refused locally and nothing reaches the wire;
   clicks, arrows, and `Tab` keep working so the frozen board stays explorable.
   "Reset board" starts over.
7. **Presence and themes.** The `15x15` board shows teammate cursors (direction
   arrow top-right, avatar bottom-right in the teammate's color, a count badge when
   two share a cell) per DESIGN section 10's bottom-right rule. The Theme toggle
   flips light/dark; both honor the SP6 color roles.

## What is real and what is fake

Real: the store and its reconciliation (pinned by the client-store vectors), the
input model (pinned by the navigation vectors through `@crossy/engine`), the wire
codec, the backoff schedule. Fake: the session behind the transport port (the demo
strip's buttons script it), participants, and the boards themselves. Wave 2.2
replaces the fake session with `src/net`'s WebSocket transport against
`apps/session` and deletes nothing but the wiring.

The Wave 1.1h playground's throwaway navigation module and its two A/B toggles are
gone: both decisions (symmetric Shift+Tab, backspace-across-blocks) are settled,
vectored, and implemented in `packages/engine` (ROADMAP "Playground
reconciliation").
