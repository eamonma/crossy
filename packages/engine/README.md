---
status: descriptive
verified: 133db08
---

# @crossy/engine

Pure domain logic for Crossy: the reducer, comparator, and navigation (DESIGN.md
sections 4 and 5), plus post-game analysis and the titles ladder
(design/post-game/*.md). Every function here is deterministic and side effect free. The
package imports nothing (INV-9): no workspace packages, no npm dependencies, no node
builtins. Timestamps and user ids arrive as plain data on commands.

The conformance vectors under `vectors/v1` are the specification. Nothing lands in
`src` before the vector that pins it. The vitest runner (`src/vectors.test.ts`) binds
each engine family to an entry point and asserts every case; the Swift port (Wave 3)
runs the same JSON through XCTest.

## Type ownership: why the engine owns its own domain types

Phase 1 exit decision, recorded here so both type worlds stay honest.

The constraint is INV-9. `packages/engine` imports nothing, and that includes
`packages/protocol`. So the engine cannot consume the wire types. Rather than smuggle
protocol types in through a shared third package (which would just relocate the
coupling INV-9 forbids), the two worlds are kept separate on purpose:

- **The engine owns its own dependency free domain types** (`src/types.ts`):
  `BoardState`, `Command`, `Event`, `Cell`, `Grid`, `Direction`, and the rest. They
  describe the game as the pure functions see it, with no notion of a socket, a JSON
  frame, or a version. They are shaped by the domain, not by the wire.
- **`packages/protocol` owns the wire types**: the message schemas, `hello`/`welcome`,
  the board payload, error codes, and the `ClientPuzzle` vs `ServerPuzzle` split that
  makes INV-6 structural. Those types are shaped by the contract on the wire.
- **The apps adapt between the two at their boundary.** The session service decodes a
  wire `placeLetter` into an engine `Command`, calls `reduce`, and encodes the engine
  `Event` back into a wire `cellSet`. The web store does the mirror. This adapter is
  the one place a change in either world is felt, and it is application code, where
  translation belongs (DESIGN.md section 4, the adapter ring).

Nothing keeps the two type worlds in agreement except the conformance vectors. Both
sides consume the same JSON files byte for byte: the engine runner asserts the engine
produces the pinned `then`, and the app and iOS suites assert their adapters and stores
round trip the same fixtures. A drift between the wire shape and the domain shape shows
up as a failing vector on one side, not as a silent type mismatch that compiles. That
is the trade INV-9 buys: no import edge between engine and protocol, and the vectors as
the shared source of truth that keeps them from diverging.

The alternative arrangements were considered and rejected. A shared types package that
both import reintroduces the exact inbound dependency INV-9 exists to forbid, and it
couples the domain vocabulary to the wire vocabulary so neither can move without the
other. Generating engine types from the protocol schema has the same coupling with an
added build step. Keeping two hand written type sets aligned by the vectors is the
lightest arrangement that honors the invariant, and it matches how the Swift port
already works: a second, independent type set held true by the same fixtures.

## Public surface

- `reduce(state, command)`: the single command reducer. Returns the sequenced events
  and the next state, or a rejection carrying a PROTOCOL.md section 11 error code. It
  normalizes values ASCII only (INV-1) and never emits `gameCompleted`.
- `applyWithCompletion(state, command, puzzle)`: the two phase completion driver. It
  reduces, then, while the board is full, runs the comparator over the whole board and
  emits exactly one `gameCompleted` on a pass (level triggered, DESIGN.md section 3).
- `matches(solution, value)`: the comparator. A filled value passes if, comparing ASCII
  case insensitively, it equals the full solution string or the solution's first
  character (D12).
- `getNextCell`, `wordBounds`, `tabTarget`, `typingAdvance`, `backspaceTarget`: the
  navigation operations pinned by the `when.op` table in `vectors/README.md`.
- `firstCorrect(...)`: attributes each cell's first correct fill to a solver from the
  event log, the ownership basis the analysis and titles both read (`first-correct.ts`).
- Post-game analysis (`analysis.ts`, design/post-game/ANALYSIS.md): `moments`,
  `momentum`, `sittings`, `solveSequence`, `solveTrace`, and `collapseIdle`, with the
  constants they use (`BURST_WINDOW_MS`, `MOMENTUM_SAMPLES`, `SITTING_GAP_MS`). Pure
  functions over the event log that derive the beats, momentum curve, sittings, and
  solve trace of a finished game.
- The titles ladder (`titles.ts`, design/post-game/TITLES.md): `awardTitles`,
  `titleStats`, and the `TITLE_LADDER` definition, plus the tuning constants
  (`BULLSEYE_MIN_FILLS`, `MARQUEE_MIN_LENGTH`, `MEDDLER_MIN`, `OPENING_SHARE`,
  `SABOTEUR_MIN`, `SPRINTER_MIN_BURST`, `STALL_FLOOR_SECONDS`). Ranks solvers into the
  per-game titles from their stats.

## ASCII only casing (INV-1)

Value normalization and comparator casing map `a-z` to `A-Z` by code point and leave
every other code point unchanged. Locale aware casing (`toLocaleUpperCase` and friends)
is forbidden: it diverges across the TypeScript and Swift ports, for example Turkish
`i` to `İ` (U+0130). The reducer and comparator vectors pin the Turkish dotted and
dotless i to catch exactly that mistake.
