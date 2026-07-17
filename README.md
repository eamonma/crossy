---
status: descriptive
---

# Crossy

A real-time collaborative crossword solver: friends open the same grid, letters appear
as anyone types, everyone sees everyone else's cursor, and the room shares one timer.

## Documents

- [`DESIGN.md`](DESIGN.md) — architecture, data model, rationale, milestones
- [`PROTOCOL.md`](PROTOCOL.md) — the wire contract (normative for the protocol)
- [`ROADMAP.md`](ROADMAP.md) — execution phases and waves, with exit criteria
- [`vectors/`](vectors/) — conformance vectors (normative over everything)

## Development

Node ≥ 24 with corepack (pnpm version is pinned via `packageManager`).

```sh
pnpm install
pnpm lint       # eslint + boundary rules (dependency-cruiser)
pnpm typecheck
pnpm test
```

All of the above run in CI on every push and must pass on a fresh clone.
