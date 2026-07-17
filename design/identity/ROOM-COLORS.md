# Room-aware color spread

Status: plan of record. Date: 2026-07-16. Decision: D28 (DESIGN.md registry).
Companion: `vectors/identity/roster.json` freezes the palette and the client bucketing
this document deliberately leaves untouched; `vectors/identity/room-colors.json` pins the
assignment below and was written before the implementation.

## Problem

Each participant's `color` is a stateless FNV-1a hash of `user_id` emitted as `#RRGGBB`.
Every client buckets that value mod 12 into the frozen 12-slot identity roster and paints
the slot's ground variant. Nothing is room-aware, so two players in one room can land on
the same slot (identical color) or on perceptually adjacent slots (poppy next to coral
next to rust, teal next to cyan, cobalt next to slate). The owner cannot tell players
apart on the grid.

## Shape

Clients never paint the wire color; they only bucket it. So the server does all the work
and no client changes a line. When emitting a participant's color, the session computes
the member's preferred slot (the hash bucket, unchanged) and, if that slot is already
claimed in the room, reassigns to the free slot most perceptually distant from every
claimed slot. It then emits a wire color whose 24-bit value buckets to the assigned slot.
Web, iOS, and the Live Activity push keep bucketing mod 12; `roster.json` stays frozen.

## Rules

1. **Join order.** Members are processed by `joined_at` ascending, ties by `user_id`
   ascending, ASCII byte order (INV-1). Earlier members always keep their color; a new
   joiner never repaints anyone.
2. **Preferred first.** The first member gets their preferred slot,
   `(fnv1a(userId) & 0xffffff) % 12`. Each later member keeps their preferred slot when
   it is free.
3. **Spread on collision.** A collided member takes the free slot maximizing the minimum
   perceptual distance to every claimed slot; ties break to the lower slot index. Fully
   deterministic.
4. **Past twelve members** duplicates are unavoidable. The candidates widen to the
   least-claimed slots (which is exactly "the free slots" while any exist, so rule 3 is
   the same rule), scored by the same minimum distance to every other claimed slot. Once
   every slot is claimed this picks the most isolated color first. No further special
   case.
5. **Distance** is a precomputed 12x12 table of pairwise OKLab deltaE between the
   light-ground roster hexes (`vectors/identity/roster.json`), scaled to integers so
   ordering is exact in any port. Computed offline; the table is committed as a constant
   in `packages/protocol` with its provenance noted.
6. **Wire emission.** A kept preferred slot emits today's exact hash bytes, so the common
   case is byte-identical to the old emitter. A reassigned slot emits the hash minimally
   adjusted so `(value % 12) == slot`: `value - value % 12 + slot`, minus 12 if that
   overflows 24 bits. Same `#RRGGBB` formatting as before.

## Where it lives

The assignment is a pure function in `packages/protocol` (`room-colors.ts`), because both
services are apps and apps never import each other. The FNV-1a hash moves there from
`apps/session/src/color.ts` (inward dependency, legal), and the session re-imports it.
Every color emitter routes through the shared function: the section 4 board payload, the
section 6 `playerConnected` notice (assigned against the same full member list, so the
two payloads agree for one room), and the Live Activity content-state. The API emits no
participant colors, so it needs nothing.

Assignment recomputes deterministically on every read from the member list the emitters
already load. No schema change, no new storage, single writer untouched. Colors carry no
board content (INV-6 untouched).

## Cost

A user's color is stable within a room but no longer guaranteed identical across rooms: a
member bumped in a colliding room reads differently there than in their others. Accepted;
the alternative (stored per-room assignments) buys stability nobody asked for with state,
a migration, and a writer question. The wire bytes for a bumped member no longer equal
the bare hash, so the wire is authoritative and a client hash fallback is only for
malformed wire strings, which is how every client already behaves.

## Rejected

- Changing the client bucketing contract: three clients plus a frozen vector churn for a
  problem the server can fix alone.
- Stored per-room color assignments: state for a display concern, plus expand/contract
  and single-writer ceremony for zero user-visible gain over deterministic recompute.
- Hue-rotating or widening the palette: the 12-slot roster is a ratified cross-client
  contract; touching it reopens web, iOS, and push at once.
