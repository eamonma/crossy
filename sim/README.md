---
status: descriptive
---

# @crossy/sim

The seeded simulation harness for M2 Track A: the regression fortress DESIGN.md section 11
names. It drives randomized multi-client sessions against the real server pipeline and the
real client store, then asserts the system invariants. Every failure prints a seed, and
re-running with that seed reproduces the failure deterministically with a small, shrunk
counterexample. That is the M2 exit criterion (ROADMAP Phase 3 Track A): harness failures
reproduce from a seed number.

Scope is the server-correctness half of M2 only. The client-facing half (derived timer
display, confetti, the completion moment's feel) is out of scope and deferred.

## What it exercises

Nothing here re-implements gameplay. The server side is the real `GameActor`
(`apps/session`), the client side is the real `GameStore` (`apps/web`). `src/sim.ts` stands
in only for the wire between them, the piece a WebSocket normally provides, and reproduces
`apps/session/src/server.ts`'s thin live-frame routing (`placeLetter`/`clearCell` reach
`actor.submit`, `requestSync` gets a `sync` board from `actor.snapshotBoard`, a reconnect
`welcome` is built the same way). A fast-check program injects the faults the protocol is
built to survive: message delay, single-frame loss forcing a resync, disconnect, and
reconnect forcing snapshot reconciliation. Delivery within one connection is never
reordered, honoring the per-connection ascending-`seq` contract (PROTOCOL.md section 7).

## Placement decision and rationale

This is a new top-level workspace directory, modeled on the existing `e2e/` precedent, with
its own `package.json`. It lives outside `packages/` and `apps/` because it must import both
an app's server pipeline (`apps/session`) and another app's client store (`apps/web`), and
the layering rule forbids one app from importing another (`.dependency-cruiser.cjs`,
`no-app-cross-imports`). A convergence property that asserts every client's rendered board
equals the server's sequenced board can only be honest if it runs the real store's real
reconciliation logic against the real actor, so re-deriving a client model inside
`apps/session` would defeat the purpose.

Dependency-cruiser treats `sim/` exactly as it treats `e2e/`: the boundary scan is
`depcruise packages apps` (root `package.json`, the `boundaries` script), so neither `e2e`
nor `sim` is a scan root, and nothing under `packages/` or `apps/` imports either, so both
are invisible to the boundary graph. There is no config change to make; the extension is to
keep the scan roots as they are, which is how `e2e/` is already handled. `pnpm lint`,
`pnpm typecheck`, `pnpm test`, and `pnpm format:check` all cover `sim/` through the
workspace globs.

No behavior code was changed, and no test seam was needed. The harness imports the actor,
hydrate, writer, and repo modules from `apps/session/src` and the store from `apps/web/src`
by relative path, using their existing public exports; `GameActor`'s constructor is already
public, so the harness constructs one in process without a factory. The only files added or
touched outside `sim/` are `pnpm-workspace.yaml` (registering `sim`, one line) and the
lockfile.

## Properties and run counts

Default run counts are bounded so `pnpm test` stays fast and deterministic on a fresh clone.
`SIM_RUNS` deepens any loop and `SIM_SEED` pins it (see Knobs).

| Property                                                             | Defends                   | Default runs | File                          |
| -------------------------------------------------------------------- | ------------------------- | ------------ | ----------------------------- |
| Total order: contiguous `seq`, no gaps or dupes                      | INV-2                     | 60           | `system.property.test.ts`     |
| Convergence: every client renders the server board                   | INV-10, DESIGN section 11 | 60           | `system.property.test.ts`     |
| Idempotency: a re-sent `commandId` never double-applies              | PROTOCOL sections 5, 8    | 60           | `system.property.test.ts`     |
| Exactly one completion under races and in-place correction           | INV-3                     | 60           | `completion.property.test.ts` |
| Terminal freeze: post-terminal mutations rejected server-side        | INV-4                     | 60           | `completion.property.test.ts` |
| Bounded-loss: rehydrate is consistent, clients converge via rollback | INV-5                     | 12           | `crash.property.test.ts`      |

The measurement (`flush-measurement.test.ts`) is not a property; it drives the actor at the
DESIGN.md section 15 default thresholds and prints observed flush batch sizes and cadence.

## Speed split

The fast property loops run entirely in process against an in-memory `RecordingPersistence`
that mirrors the two session-owned tables (append the log, upsert the snapshot). No Docker,
no sockets, thousands of programs per second.

Only INV-5 genuinely needs a real flush and rehydrate, because the "snapshot and log agree"
guarantee is a property of the one real write-behind transaction (`apps/session/src/writer.ts`)
and the real hydrate read path (`repo.ts`, `hydrate.ts`), not of a fake. That property runs
against Testcontainers Postgres, the pattern already used in `apps/session` and
`packages/db`. It runs as the least-privilege `crossy_session` role, so the flush is
exercised against the real grants (INV-7).

No silent skip: if Docker is unreachable the INV-5 suite FAILS with a clear message rather
than skipping, matching the repo stance (a skipped infrastructure test reads as a passing
one).

## Knobs

- `SIM_RUNS=<n>`: override the run count for every property (deep runs on demand). Nightly
  deep runs are an M7 item, not wired here.
- `SIM_SEED=<n>`: pin the fast-check seed for a deterministic replay of a reported failure.
- `SIM_VERBOSE=1`: fast-check verbose mode (lists every generated value on failure).

Examples:

```
pnpm --filter @crossy/sim test                 # bounded, fresh-clone default
SIM_RUNS=1000 pnpm --filter @crossy/sim test   # deep
SIM_SEED=367954301 pnpm --filter @crossy/sim test   # reproduce a specific failure
```

## Reproducibility

Determinism is the point (DESIGN.md section 11). There is no wall clock, no `Math.random`,
and no real timer on the logic path: the actor's clock is an injected counter, command ids
come from an injected counter, and submissions are drained one at a time in FIFO order. A
program is therefore a pure function of the values fast-check supplies, so a failure replays
from its seed and fast-check shrinks it to a minimal counterexample. When no seed is pinned,
fast-check draws one and prints it on failure.
