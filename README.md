---
status: descriptive
---

# Crossy

Collaborative crosswording.

Friends join by link and work in the same grid. A letter typed by one person appears
for everyone, along with their cursor. The room keeps one timer. Reactions happen on
the puzzle itself. After the last square, Crossy can replay the solve and show who
filled what.

[Play Crossy](https://crossy.party)

<!-- Add a real mid-solve room screenshot here: multiple players, cursors, and the shared timer. -->

## Run locally

Local development needs Node 24 or later, Corepack, and Docker. `package.json` pins
the pnpm version.

```sh
pnpm install
pnpm dev:stack
```

`pnpm dev:stack` starts Postgres, the API, the WebSocket service, and the web app. It
creates a small puzzle and prints two links to the same room, each signed in as a
different player. Open them in separate tabs to play both sides. Press Ctrl+C to
flush pending events and stop the stack.

The main checks are:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm smoke
```

`pnpm test` and `pnpm smoke` use Docker. The smoke test also expects Chromium to be
installed through Playwright. Swift and Kotlin are checked separately when native
code changes.

## Inside the repo

Crossy keeps live play separate from ordinary web requests. Live play goes through
the WebSocket service in `apps/session`. Each room has one in-memory actor that
decides the order of incoming moves, then writes the event log and latest board to
Postgres. `apps/api` handles accounts, puzzles, and room membership. Supabase handles
sign-in.

The React web app lives in `apps/web`. The native apps use SwiftUI on iOS and Compose
on Android. `apps/extension` adds puzzles from supported crossword sites to a user's
library.

The game rules have separate TypeScript, Swift, and Kotlin implementations. All three
run the same JSON cases from `vectors/`. This catches drift without making the
platforms share implementation code.

## Project documents

- [`DESIGN.md`](DESIGN.md): architecture, data model, and rationale
- [`PROTOCOL.md`](PROTOCOL.md): realtime wire contract
- [`ROADMAP.md`](ROADMAP.md): implementation record and plans
- [`vectors/`](vectors/): executable conformance specification
