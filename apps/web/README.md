---
status: descriptive
verified: 133db08
---

# apps/web

The Vite + React SPA, deployed through the live pipeline. Live mode (`LiveApp.tsx`,
`/game/<id>`) runs the real `GameStore` over a real WebSocket to `apps/session`
(`src/net/wsTransport.ts`, `connect.ts`), with grid input driven entirely by
`@crossy/engine`'s navigation ops per the desktop interaction spec. Around the board
sit the account and gameplay surfaces: identity and auth (`src/identity/`, Supabase and
mock adapters), the display-name and profile flows (`src/profile/`) over `authedFetch`,
live reactions (`src/reactions/`), and product analytics (`src/analytics/`, PostHog
behind a noop-by-default port). The same `GameStore`, grid, and engine navigation also
back a demo mode: a tiny in-memory session (`src/demo/fakeSession.ts`) stands in for
`apps/session` behind the store's transport port, so the demo boards and the taste-pass
strip exercise the exact code paths a live socket drives, with no server.

## Run it

```
pnpm install
pnpm --filter @crossy/web dev
```

Open the printed URL. Click any cell to focus the grid, then use the keyboard.

Other scripts: `pnpm --filter @crossy/web test` (the client-store vector suite plus
unit tests), `pnpm --filter @crossy/web build`, `pnpm --filter @crossy/web typecheck`.

## Taste pass (local M1 stack)

`pnpm dev:stack`, run from the repo root, stands up the real stack the product owner
plays for the M1 typing-feel taste pass: Testcontainers Postgres with migrations, the
api, the session service, and this Vite dev server (hot reload, not a build), on stable
ports. It seeds one demo game on a real 5x5 puzzle and prints two urls, one per
identity. Open each in its own tab. The token in the url is the player, so the two tabs
are two solvers already joined to one game (Ada the host, Grace the solver).

What to feel:

- **Typing latency.** Type in one tab and watch letters land in the other. Your own
  letters render instantly through the optimistic overlay (INV-10); the round trip you
  are judging is the teammate tab catching up.
- **Conflict flash.** Put both cursors on the same cell and type different letters. The
  overwritten cell flashes the writer's presence color and fades over 300 ms (Decision
  2.1d-1).
- **Cursor motion.** Your own cursor advances with filled-skip as you type and snaps on
  click, with no motion tween (Decision 2.1d-2).
- **Resync pill on a killed connection.** In one tab open devtools, go to the Network
  panel, and switch it to Offline (or set throttling to Offline). Type a few letters,
  then switch back to Online. The Reconnecting and Resyncing pill shows while the
  socket is down, the transport reconnects on its own, and both boards reconcile from
  the snapshot (PROTOCOL sections 7 and 8).

Press Ctrl+C to stop: it drains the session (SIGTERM, so the write-behind flush runs)
then stops the containers. Tokens in the printed urls last one hour, so re-run for
fresh ones. Live teammate cursors are not broadcast in this wave, so a teammate shows
up through their landed letters and the conflict-flash color, not a moving cursor.

If a run is killed without draining (a dropped SSH session, a `kill -9`), its services
can survive holding the ports. The next `pnpm dev:stack` reaps its own leftovers on
startup before checking ports, so you rarely notice. To clean up without starting a
stack, run `pnpm dev:stack:reap`. Reaping only ever kills processes it confirms are this
repo's, never anything else on those ports.

## Layout

- `src/store/` - `GameStore`: sequenced cells, the INV-10 overlay, the three
  connection states (`live`, `resyncing`, `reconnecting`), snapshot reconciliation.
  Speaks wire types through an injected transport. Its specification is
  `vectors/v1/client-store/`; `client-store.vectors.test.ts` discovers and executes
  every case against the real store, decoding server stimuli through
  `@crossy/protocol`'s codec.
- `src/net/` - the WebSocket transport (`wsTransport.ts`): hello, heartbeat, codec
  decode, and the PROTOCOL section 7 reconnect backoff (0, 1, 2, 4, 8, 16, 30 s capped,
  full jitter, reset after a 30 s survival), unit-tested in `backoff.test.ts` and
  `wsTransport.test.ts`. `connect.ts` wires it into live mode; `authedFetch.ts` is the
  bearer-authenticated REST client the account surfaces call.
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

## Live mode and demo mode

Live mode (`LiveApp.tsx`) is the real product: the `GameStore` speaks the wire codec
over `src/net`'s WebSocket transport against a real `apps/session`, authenticated
identities join real games, and the board only ever renders from the WS store (INV-6).
Everything the store and input model do is pinned by vectors: the store and its
reconciliation by the client-store vectors, the input model by the navigation vectors
through `@crossy/engine`, plus the wire codec and the backoff schedule.

Demo mode reuses that same store, grid, and input against `src/demo/fakeSession.ts`, an
in-memory session behind the transport port. The demo strip's buttons script it, so the
demo boards and participants are local fixtures, not a server. It exists to exercise and
show off the interaction model with no backend, and to drive the taste pass; the live
path shares its every code seam.

The Wave 1.1h playground's throwaway navigation module and its two A/B toggles are
gone: both decisions (symmetric Shift+Tab, backspace-across-blocks) are settled,
vectored, and implemented in `packages/engine` (ROADMAP "Playground
reconciliation").
