# Crossy

Real-time collaborative crossword solver. Read `DESIGN.md` (architecture, data model,
rationale) and `PROTOCOL.md` (wire contract) before touching gameplay code; `ROADMAP.md`
tracks execution phases/waves and what is currently unblocked.

There are multiple agents working in workstreams that may merge into main here at any
time, so don't be surprised if main changes without you knowing. Rebase often. Work on
a branch per wave-track; keep PRs scoped to one track.

## Precedence when sources disagree

Conformance vectors (`vectors/`) > `PROTOCOL.md` > `DESIGN.md` prose > any
implementation. A divergence between an implementation and a vector is a bug in the
implementation (or a reviewed vector change), never a reason to fork behavior.

## Commands

- `pnpm install` — workspace install (pnpm via corepack; version pinned in `packageManager`)
- `pnpm lint` — eslint + boundary rules (dependency-cruiser)
- `pnpm typecheck` — `tsc --noEmit` in every workspace package
- `pnpm test` — vitest in every workspace package
- `pnpm format` / `pnpm format:check` — prettier

All four checks run in CI on every push and must be green on a fresh clone; fresh-clone
reproducibility is a launch gate (DESIGN.md §9).

## Writing style

- Avoid AI isms in prose
- Avoid em dashes
- Write with clarity and purpose
- Use high leverage language
- Be concise

## Hard rules

- **Engine purity (INV-9)**: `packages/engine` imports nothing — no other workspace
  packages, no npm deps, no node builtins. No IO, clock, randomness, or ambient
  identity; timestamps and user ids arrive as data. Enforced by dependency-cruiser.
- **Layering**: dependencies point inward only. Apps may import `packages/*`; packages
  never import apps; apps never import each other.
- **INV-6**: solutions never leave the server. Client-facing payloads are typed
  `ClientPuzzle` (no solution field). Never add runtime stripping as a substitute.
- **Single writer per table** (DESIGN.md §9). Cross-service schema changes are
  expand/contract, never a breaking rename in one deploy.
- **ASCII-only casing** everywhere values are normalized or compared; locale-aware
  casing is forbidden (INV-1).
- Test names cite the invariant they defend (`INV-n`) so coverage is greppable.
- `vectors/` and `packages/protocol` are shared normative ground: small, focused PRs
  reviewed against `PROTOCOL.md`. Vectors are written before implementations.
- No build orchestrator (turbo/nx) until it hurts. Plain pnpm workspaces.
