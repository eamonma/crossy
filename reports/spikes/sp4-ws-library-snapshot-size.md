# SP4: Session WS library + snapshot size

**Questions.** Two, both blocking Wave 2.1c (the session service):

1. Which server WebSocket library should the session service use: `ws`,
   `uWebSockets.js`, or the platform primitive? Criteria in priority order:
   backpressure visibility and control, `permessage-deflate` support and its real
   per-connection memory cost, TypeScript ergonomics, maintenance health, deploy
   friction.
2. Is PROTOCOL.md section 1's under-20 KB resync claim true for a worst-case 25x25
   board under `permessage-deflate`?

**Answers.**

1. **Use `ws`.** Both `ws` and `uWebSockets.js` satisfy the top-priority backpressure
   requirement (demonstrated below), so the decision falls to the lower criteria,
   where `ws` wins on ergonomics, maintenance, and decisively on deploy friction:
   `uWebSockets.js` is not on the npm registry (GitHub-only) and ships ABI-pinned
   native binaries that failed to load on Node 24 until its newest release, which
   collides head-on with the fresh-clone-reproducibility launch gate (CLAUDE.md,
   DESIGN.md section 9). The platform primitive is not a candidate: Node 24 has a
   client `WebSocket` global but no server-side WebSocket at all.
2. **Yes, with a large margin.** The worst-case 25x25 board payload is 34.8 KB raw and
   **2.95 KB** under `permessage-deflate`, roughly 6.6x under the 20 KB budget. The
   "roughly 30 KB raw" figure is accurate (33 to 37 KB across cases). One clarifying
   finding: section 1's claim scope is the board payload; clues ship separately via
   REST (section 4). Even a combined first-load of board plus every clue compresses to
   about 6.7 KB, still well under 20 KB. No change to PROTOCOL.md section 1 is needed.

**Confidence: high, both.** Backpressure behavior is reproduced empirically for each
library; snapshot sizes are measured and validated against real `ws` `permessage-deflate`
wire bytes (proxy within 5 bytes of the on-wire frame). The one caveat sits on deploy
friction, which is best confirmed on the real target during SP3 (Railway), since the
binary-matrix risk is a property of the deploy image's Node version, not of local runs.

Spike code was throwaway per the rules and is not committed; harness sketch is in the
appendix.

## Method

Node 24.0.2, `ws` 8.21.0 (+ `@types/ws` 8.18.1), `uWebSockets.js` 20.68.0. Four
throwaway harnesses:

- **Backpressure.** A server pumps 100 KiB frames at a deliberately stalled consumer
  (a real client whose underlying socket is paused, so it never reads and TCP
  backpressures), while the server logs what the library exposes as its send buffer
  grows. A healthy reader runs alongside for contrast.
- **Snapshot size.** A generator builds the board payload from PROTOCOL.md section 4:
  full grid with 180-degree symmetric blocks, every playable cell filled, attribution
  rotated across a cast of 4 to 8 UUIDs, a handful of rebus cells, presence entries,
  cursors, `recentCommandIds`, and the `welcome` envelope. Clues (REST, section 4) are
  generated separately with realistic text for both directions. Raw JSON bytes and
  `permessage-deflate`-equivalent bytes (`zlib.deflateRawSync`, raw DEFLATE, windowBits
  15) are measured for a 15x15 daily and 25x25 cases.
- **Compression fidelity.** The worst-case board is sent over a real `ws` connection
  with `permessage-deflate` enabled; the client counts raw TCP bytes of the frame to
  confirm the `zlib` proxy.
- **Deflate memory.** A server measures its own RSS across 300 connections (clients
  forked into a separate process) with compression off and on, for both libraries.

## Question 1: library choice

### Criterion 1, backpressure (top priority): both pass; `ws` is sufficient

`ws` exposes `bufferedAmount`, a synchronous getter the actor reads on every broadcast.
Against a stalled consumer it climbs monotonically; a threshold plus `ws.terminate()`
is the kill switch. A healthy reader stays flat.

```
[server] stalled: sent= 40 bufferedAmount=1.37 MiB
[server] stalled: sent= 60 bufferedAmount=3.32 MiB
[server] stalled: sent= 80 bufferedAmount=5.27 MiB
[server] stalled: sent=100 bufferedAmount=7.23 MiB
[server] stalled: KILL SWITCH at bufferedAmount=8397620 (sent=108). ws.terminate()
[server] healthy: sent=400 bufferedAmount=0.00 MiB  (400 socket 'drain' events)
```

`uWebSockets.js` exposes `getBufferedAmount()` plus a `send()` return status
(SUCCESS / BACKPRESSURE / DROPPED) and, uniquely, a declarative bound: set
`maxBackpressure` and the library caps the buffer for you. By default it then silently
**drops** further frames (dangerous here, since every broadcast is a state mutation);
with `closeOnBackpressureLimit: true` it disconnects instead.

```
[server] sent= 60 send()=BACKPRESSURE getBufferedAmount=3.18 MiB
[server] sent= 70 send()=DROPPED      getBufferedAmount=4.06 MiB
[server] socket closed by server/library, code=1006, sent=70   (closeOnBackpressureLimit)
```

Both meet the stated requirement: the actor can see a slow client's buffer fill and
disconnect rather than balloon memory. `uWebSockets.js` is marginally richer (a
declarative kill switch versus a polled getter plus `terminate()`), but this is a pass
for both, not a decider. Because the top-priority criterion ties, the decision is made
by the criteria below.

### Criterion 2, permessage-deflate memory: `uWebSockets.js` leaner, but it does not bind here

RSS delta per connection, 300 connections, one message each to force compressor
allocation:

| Library | no compression | shared compressor | dedicated (per-conn) |
| ------- | -------------- | ----------------- | -------------------- |
| `ws`    | 18.8 KB        | not available     | **236.7 KB**         |
| `uWebSockets.js` | 5.9 KB | 14.1 KB          | 79.7 KB              |

`ws` `permessage-deflate` at defaults costs about 220 KB of zlib buffers per
connection, the well-known figure; `uWebSockets.js` is leaner everywhere and its
`SHARED_COMPRESSOR` gives near-free compression memory. This is a real advantage for
`uWebSockets.js`, but it does not bind for Crossy, for two reasons. First, the only
large message is the resync snapshot, which is reconnect-only; steady-state traffic is
tiny `cellSet` frames (about 150 bytes) where deflate is pointless and can inflate.
Second, the right design is to not run blanket `permessage-deflate` and instead
compress only the snapshot at the application layer (deflate the board JSON into one
frame), which removes the persistent per-connection zlib context entirely. With deflate
off, `ws` costs 18.8 KB per connection, fine at Crossy's friends-scale. The snapshot
measurements below show this recovers the full 34.8 KB to 2.8 KB win with no standing
memory cost.

### Criteria 3 and 4, ergonomics and maintenance: `ws`

- **`ws`**: on npm, MIT, last published 2026-06-29; types via `@types/ws` (current,
  DefinitelyTyped). Standard `WebSocketServer`, and it attaches to a Node `http.Server`
  `upgrade` event, so the session service can serve health and `/internal` HTTP on the
  same listener. Idiomatic Node stream semantics.
- **`uWebSockets.js`**: Apache-2.0, bundled `index.d.ts` (types are actually good), but
  a single-maintainer project distributed only from GitHub. Its API is idiosyncratic:
  the socket object is invalidated after close and must not be retained, per-socket data
  goes through `getUserData()`, and it runs its own HTTP server rather than Node's, so
  co-hosting the internal HTTP endpoints means a second surface or a second port.

### Criterion 5, deploy friction: `ws` wins decisively

`uWebSockets.js` is **not on the npm registry** (`npm view` returns 404); it installs
only from a GitHub tarball. It ships prebuilt, ABI-pinned `.node` binaries named by
Node's `NODE_MODULE_VERSION`. Observed directly:

- v20.51.0 shipped ABIs 108/115/127/131 (Node 18/20/22/23) and **threw on load under
  Node 24** ("supports only Node.js versions 18, 20, 22 and 23").
- Only v20.54.0 and later ship ABI 137 (Node 24). The latest, v20.68.0, ships
  127/137/147 and has **dropped** 18/20/23.

So the supported-Node window is a moving target you must track in lockstep with the
deploy image, and install depends on GitHub being reachable rather than the npm
registry. Both facts cut against DESIGN.md section 9's launch gate that a fresh clone
must `pnpm install` and go green reproducibly. `ws` is pure JS: it installs from npm and
runs on any Node version with no binary step.

### The platform primitive is not a candidate

Node 24 exposes a global `WebSocket` (client only, from undici). There is no server-side
WebSocket: `WebSocketServer` is undefined and `node:ws` does not exist. Building a server
on the platform means hand-rolling RFC 6455 framing over `http.Server`'s `upgrade`
event, which is exactly what `ws` already is, done correctly (fragmentation, control
frames, close semantics, optional `permessage-deflate`). No reason to reimplement it.

### Recommendation

**`ws`.** It meets the top-priority backpressure requirement as demonstrated, wins
ergonomics, maintenance, and deploy friction, and its one weakness (deflate memory) is
designed around by compressing only the rare resync snapshot rather than the whole
stream. Enable `permessage-deflate` off by default and compress the snapshot at the app
layer, or negotiate deflate with a reduced `memLevel`/`windowBits` if a standing
per-connection context is ever wanted. Revisit `uWebSockets.js` only if profiling under
real load shows `ws` throughput or per-socket memory is the bottleneck, which is
implausible at friends-scale.

## Question 2: snapshot size

`permessage-deflate` proxy is `zlib.deflateRawSync` (raw DEFLATE, windowBits 15);
level 6 is the `ws`/zlib default. Board payload is the section 1 resync scope; the
combined row adds the REST clues for a full first-load picture.

| Scenario (grid, cast, blocks; filled / clues) | Payload | Raw JSON | pmd (level 6) | pmd (level 9) | ratio |
| --------------------------------------------- | ------- | -------- | ------------- | ------------- | ----- |
| 15x15 daily, 6 users, 17% blocks; 187 / 60    | board (resync)        | 13.83 KB | **2.01 KB** | 2.01 KB | 6.9x |
|                                               | welcome envelope      | 13.95 KB | 2.07 KB | 2.06 KB | 6.8x |
|                                               | combined + clues      | 18.71 KB | 3.61 KB | 3.60 KB | 5.2x |
| 25x25 realistic, 6 users, 17% blocks; 519 / 160 | board (resync)      | 32.75 KB | **2.44 KB** | 2.40 KB | 13.4x |
|                                               | welcome envelope      | 32.86 KB | 2.50 KB | 2.45 KB | 13.2x |
|                                               | combined + clues      | 45.96 KB | 6.08 KB | 5.97 KB | 7.6x |
| 25x25 WORST, 8 users, 12% blocks; 550 / 138   | board (resync)        | 34.76 KB | **2.95 KB** | 2.92 KB | 11.8x |
|                                               | welcome envelope      | 34.87 KB | 3.01 KB | 2.98 KB | 11.6x |
|                                               | combined + clues      | 46.99 KB | 6.65 KB | 6.55 KB | 7.1x |
| 25x25 ceiling, 8 users, 0 blocks; 625 / 50    | board (resync)        | 37.18 KB | **2.67 KB** | 2.64 KB | 13.9x |
|                                               | welcome envelope      | 37.29 KB | 2.73 KB | 2.71 KB | 13.6x |
|                                               | combined + clues      | 44.89 KB | 6.18 KB | 6.13 KB | 7.3x |

Wire-fidelity check on the worst-case welcome envelope, over a real `ws`
`permessage-deflate` connection:

```
raw JSON              : 35708 bytes (34.87 KB)
zlib deflateRaw(6)    : 2890 bytes (2.82 KB)   <- proxy used above
ws permessage-deflate : 2895 bytes (2.83 KB)   <- real wire frame incl WS header
delta                 : 5 bytes
```

**Why it compresses so hard, as section 1 predicts:** the payload is dominated by the
repeated `{"v":...,"by":...}` structure and a handful of repeated participant UUIDs.
DEFLATE crushes that to a 12x to 14x ratio at the 25x25 cap. Level 9 buys almost
nothing over level 6, so the default setting is the right one.

### Verdict on PROTOCOL.md section 1

**The under-20 KB claim holds, comfortably.** Worst realistic 25x25 board: 2.95 KB
compressed, about 6.6x under budget. Absolute ceiling (all 625 cells filled, no
blocks): 2.67 KB. Raw sizes match the "roughly 30 KB" prose (33 to 37 KB). No PROTOCOL
change is warranted.

Two findings worth carrying forward, neither a fix:

- **Scope.** Section 1's claim is about the board payload. Clues are not in it; they
  come from REST once per game (section 4) and are immutable, so they are not part of
  the resync transfer. The prose is consistent with this, and the numbers confirm it.
  For completeness, even board plus all clues in one shot is about 6.7 KB compressed,
  still well under 20 KB, so a client that fetches everything at join is fine too.
- **Where compression pays.** The 20 KB budget lives entirely on the snapshot, and the
  snapshot is reconnect-only. This is the design hook for question 1's recommendation:
  compress the snapshot, not the keystroke stream.

## Appendix: reproduction

Throwaway, kept out of the tree. Node 24, a scratch dir, `npm i ws @types/ws` and
`npm i uNetworking/uWebSockets.js#v20.68.0`. Four scripts:

1. Backpressure: `WebSocketServer` (and `uWS.App().ws`) pumps 100 KiB frames at a
   client that calls `_socket.pause()`; log `bufferedAmount` / `getBufferedAmount()`
   each batch; fire `terminate()` (or `closeOnBackpressureLimit`) past a threshold.
2. Snapshot: build the section 4 board with symmetric blocks, round-robin UUID
   attribution, rebus cells, presence, cursors, `recentCommandIds`, the `welcome`
   envelope, and separate REST clues; measure `JSON.stringify` bytes and
   `zlib.deflateRawSync`.
3. Wire check: send the worst-case envelope over `ws` with `perMessageDeflate` and sum
   the client socket's first data frame.
4. Memory: server reports its own RSS across 300 forked-client connections, compression
   off and on, both libraries.
