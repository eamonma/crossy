# Live Activity content-state vectors

Normative fixtures for the iOS Live Activity content-state payload (PROTOCOL.md
"Live Activity push"). One JSON object travels inside the APNs Live Activity
envelope as `aps.content-state`. The TypeScript emitter (a later slice in
`apps/session`) encodes it; the Swift widget's `Codable` decodes it. These vectors
pin the shape both sides agree on, byte for byte.

Precedence when sources disagree: these vectors, then PROTOCOL.md, then any
implementation.

## Why this lives beside `v1/`, not inside it

`vectors/v1/` is the protocol-version-1 suite. Its family set is a closed registry:
the engine runner (`packages/engine/src/vectors.test.ts`) and the Swift runner
(`apps/ios/Tests/VectorRunnerTests`) both throw on any directory under `v1/` that is
not a registered family. The content-state payload is not a protocol-v1 engine or
client-store behavior; it is a push-channel wire contract with its own consumers. It
gets its own top-level family directory so it never collides with the `v1/` runners'
registry, and so its Swift consumer (a later slice) registers itself without editing
the `v1/` enum.

## Layout

```
vectors/
  live-activity/
    content-state.json
    clock-schedule.json
```

- One JSON file per behavior cluster, kebab-case basename, `.json` extension. Each
  file is a bare JSON array of cases, UTF-8, prettier-formatted (matches `v1/`).
- `content-state.json` cases are `{ name, contentState }`. `contentState` is the
  literal payload the emitter encodes and the widget decodes.
- `clock-schedule.json` cases are `{ name, ageSeconds, register, reading? }` and pin
  the elapsed-clock register schedule (below).

## The payload

```json
{
  "pucks": [
    {
      "initial": "E",
      "red": 214,
      "green": 178,
      "blue": 92,
      "connected": true,
      "userId": "a1b2c3d4-0001-4a1a-8b2b-000000000001"
    }
  ],
  "filled": 34,
  "total": 78,
  "status": "ongoing",
  "completedAt": null
}
```

- `pucks`: the live roster cluster, at most 4, in presence order. Each puck is
  render-ready: `initial` is a single ASCII-uppercased letter (INV-1), `red`/`green`/
  `blue` are 8-bit sRGB components (0-255) resolved server-side for the island's dark
  ground, and `connected` drives away-dimming. `userId` is the member's opaque user id
  (the same value the section 4 participant payload carries), which the widget keys
  locally-cached avatar art off; it is null or absent when unknown, and reveals nothing
  toward the solution (INV-6). The cluster rides content-state, not attributes, so a
  member who joins after the activity started still appears.
- `filled` / `total`: fill progress as counts. COUNTS ONLY: no letters, no cell
  coordinates, nothing that leaks toward the solution (INV-6).
- `status`: `"ongoing"` | `"completed"` | `"abandoned"`.
- `completedAt`: ISO-8601 UTC, set exactly when `status` is `"completed"`, else null.

## Cases

`content-state.json` covers: an ongoing room with mixed connected and disconnected
pucks; a four-puck at-cap cluster; a completed room carrying `completedAt`; an
abandoned room with a frozen partial fill and no `completedAt`; a minimal single-puck
room on a small grid. The `userId` field appears in all three tolerant-decode forms:
a present opaque id, an explicit null (the ongoing room's third puck), and an absent
field (the abandoned room's puck), so both sides stay pinned on the absent form.

## The clock schedule

The island's elapsed clock is computed on device from the activity's immutable
anchor (the room's `firstFillAt`), never pushed. Its register coarsens with the
room's age instead of growing digits (PROTOCOL.md 12a):

- `ticking` (age under an hour): the native auto-updating timer, MM:SS.
- `coarse` (an hour to a week): a static reading, H:MM under a day, whole days past
  it. `reading` carries the exact string.
- `infinity` (a week or older): the infinity mark.

`clock-schedule.json` pins the schedule for both consumers. The Swift register law
(`IslandPresentation.elapsedRegister`) must map each case's `ageSeconds` to its
`register` and `reading`. The server's push policy must treat the ticking/coarse
straddle (3599/3600) as the boundary it guarantees a render for: a register change
applies only when the widget renders, so when no organic update has been pushed
since the boundary passed, the server sends a clock push that re-asserts the last
content-state and causes the flip (PROTOCOL.md 12a).
