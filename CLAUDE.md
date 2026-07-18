# Crossy

Real-time collaborative crossword solver. Read `DESIGN.md` (architecture, data model,
rationale) and `PROTOCOL.md` (wire contract) before touching gameplay code; `ROADMAP.md`
tracks execution phases/waves and what is currently unblocked.

There are multiple agents working in workstreams that may merge into main here at any
time, so don't be surprised if main changes without you knowing. Rebase often. Work on
a branch per wave-track; keep PRs scoped to one track.

Main is golden: every change lands through a PR with green checks (enforced by a
repository ruleset; squash merges, no direct pushes). Deploys happen only from the
pipeline off main, never from a local machine. The one exception is first-time
provisioning (creating a service, minting a secret), which is done once and committed
as config-as-code.

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

## Working model

Claude orchestrates; substantive implementation goes to worktree-isolated subagents.
The orchestrator reviews diffs, pushes agent branches, opens PRs, and arms squash
auto-merge. Subagents never push. Small doc edits may be done inline. Nothing is
racing a deadline.

Strong preference for TDD. Write the failing test first (a vector where the behavior
is normative, a unit or integration test otherwise), watch it fail, then implement to
green. Tests written after the code assert what it does, not what it should; the
vectors-before-implementations rule below is this preference made law for shared
ground. Briefs to subagents carry the same expectation.

Owner-held, never do directly: secret and DNS mutations, Supabase/Railway dashboard
changes, production deploys and destructive migrations. Ask, with the exact command
ready to paste.

- The owner's commit signing needs a hardware key: agent commits and rebases use
  `-c commit.gpgsign=false`. Force-pushes are owner-run; hand over the command.
- Any brief that starts services mandates teardown plus an orphan sweep afterward.
- When a diff changes a contract, sweep callers outside its fence (`e2e/`,
  `scripts/`) before merging.

## Design taste

High-end and intentional: Verner Panton, the Eameses, space-age; claude.ai and
apple.com product pages as quality bars. Lead with a point of view and named
directions the owner can react to. Work that reads as AI slop gets killed, UI or
prose. The web UI is not a visual spec for other platforms.

## Recurring gotchas

- macOS is case-insensitive: sibling module basenames must differ in more than case
  (`PartyView.tsx` vs `partyView.ts` class of bug; three occurrences so far).
- Read gradle exit codes from gradle's own `$?`, never a piped tail's.

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
