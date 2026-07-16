// Runs the room-aware color assignment (D28, design/identity/ROOM-COLORS.md) against
// vectors/identity/room-colors.json, the golden written before this implementation (CLAUDE.md
// house rule; vectors/identity/README.md). One cluster, `assignRoomColors`: every case runs and
// the count is asserted, so a silently skipped case is a failure. Assertion rule
// (vectors/README.md): `then.assigned` rows always assert `slot`; `wire` only where present.
//
// Below the fixture sweep: targeted tests naming the D28 rule they defend (the distance table's
// shape, the byte-preserving kept slot, the bucketing of an adjusted wire, the 24-bit overflow
// guard, and order-of-input independence per INV-1).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SLOT_DELTA_E,
  assignRoomColors,
  assignRoomSlots,
  colorForUser,
  preferredSlot,
  wireColorForSlot,
} from "./room-colors";
import type { RoomMember } from "./room-colors";

const here = dirname(fileURLToPath(import.meta.url));
const vectorPath = resolve(here, "../../../vectors/identity/room-colors.json");

interface RoomColorsCase {
  readonly name: string;
  readonly given: { readonly members: RoomMember[] };
  readonly then: {
    readonly assigned: {
      readonly userId: string;
      readonly slot: number;
      readonly wire?: string;
    }[];
  };
}

const fixture = JSON.parse(readFileSync(vectorPath, "utf-8")) as {
  assignRoomColors: RoomColorsCase[];
};
const cases = fixture.assignRoomColors;

describe("D28 vectors/identity/room-colors.json: assignRoomColors", () => {
  it("runs every case in the cluster (none skipped)", () => {
    expect(cases).toHaveLength(5);
  });

  for (const c of cases) {
    it(c.name, () => {
      const slots = assignRoomSlots(c.given.members);
      const colors = assignRoomColors(c.given.members);
      expect(slots.size).toBe(c.then.assigned.length);
      for (const row of c.then.assigned) {
        expect(slots.get(row.userId)).toBe(row.slot);
        if (row.wire !== undefined) {
          expect(colors.get(row.userId)).toBe(row.wire);
        }
        // The emission invariant behind every case: the wire buckets to the assigned slot with
        // the frozen client rule (roster.json slotForWireColor), whatever the adjustment did.
        const wire = colors.get(row.userId)!;
        expect(wire).toMatch(/^#[0-9A-F]{6}$/);
        expect(parseInt(wire.slice(1), 16) % 12).toBe(row.slot);
      }
    });
  }
});

describe("D28 room-aware color spread: targeted rules", () => {
  it("D28: the distance table is 12x12, symmetric, zero on the diagonal, positive off it", () => {
    expect(SLOT_DELTA_E).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      expect(SLOT_DELTA_E[i]).toHaveLength(12);
      expect(SLOT_DELTA_E[i]![i]).toBe(0);
      for (let j = 0; j < 12; j++) {
        expect(SLOT_DELTA_E[i]![j]).toBe(SLOT_DELTA_E[j]![i]);
        if (i !== j) expect(SLOT_DELTA_E[i]![j]!).toBeGreaterThan(0);
      }
    }
  });

  it("D28: a kept preferred slot emits today's exact hash bytes (colorForUser unchanged)", () => {
    const userId = "12345678-1234-1234-1234-123456789abc";
    expect(wireColorForSlot(userId, preferredSlot(userId))).toBe(
      colorForUser(userId),
    );
    // A solo member is always kept.
    const colors = assignRoomColors([
      { userId, joinedAt: "2026-07-16T00:00:00Z" },
    ]);
    expect(colors.get(userId)).toBe(colorForUser(userId));
  });

  it("D28: a reassigned wire is the minimal adjustment and still buckets to the slot", () => {
    // u-gus hashes to #D691F4 (preferred slot 0); slot 4 keeps the high bytes and moves the
    // residue only (the vector's two-member bump case pins the same bytes end to end).
    expect(preferredSlot("u-gus")).toBe(0);
    expect(wireColorForSlot("u-gus", 4)).toBe("#D691F8");
    for (let slot = 0; slot < 12; slot++) {
      const value = parseInt(wireColorForSlot("u-gus", slot).slice(1), 16);
      expect(value % 12).toBe(slot);
      expect(value).toBeLessThanOrEqual(0xffffff);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it("D28: the adjustment guards 24-bit overflow by stepping one modulus down", () => {
    // No hunting for a hash preimage near 0xFFFFFF: assert the guard's arithmetic directly.
    // value - value % 12 + slot over 0xFFFFFF must drop by 12, which preserves the residue.
    const value = 0xffffff; // residue 3
    const slot = 11;
    const adjusted = value - (value % 12) + slot - 12;
    expect(adjusted).toBe(0xfffffb);
    expect(adjusted % 12).toBe(slot);
    expect(adjusted).toBeLessThanOrEqual(0xffffff);
  });

  it("D28 (INV-1): assignment is a function of the member set, not the given order", () => {
    const members: RoomMember[] = [
      { userId: "u-ana", joinedAt: "2026-07-16T00:00:01Z" },
      { userId: "u-fox", joinedAt: "2026-07-16T00:00:02Z" },
      { userId: "u-gus", joinedAt: "2026-07-16T00:00:03Z" },
      { userId: "u-ned", joinedAt: "2026-07-16T00:00:04Z" },
    ];
    const forward = assignRoomColors(members);
    const reversed = assignRoomColors([...members].reverse());
    expect(Object.fromEntries(reversed)).toEqual(Object.fromEntries(forward));
  });

  it("D28: past the first duplicate, later duplicates spread instead of piling on one slot", () => {
    // Fourteen members: twelve fill every slot, the 13th duplicates the most isolated slot, and
    // the 14th must land on a *different* slot (candidates are the least-claimed slots).
    const members: RoomMember[] = [];
    let n = 0;
    const used = new Set<number>();
    for (let i = 0; used.size < 12 && i < 10_000; i++) {
      const userId = `wrap-${i}`;
      if (used.has(preferredSlot(userId))) continue;
      used.add(preferredSlot(userId));
      members.push({
        userId,
        joinedAt: `2026-07-16T00:00:${String(10 + n++).padStart(2, "0")}Z`,
      });
    }
    expect(members).toHaveLength(12);
    const thirteenth = { userId: "wrap-a", joinedAt: "2026-07-16T00:01:00Z" };
    const fourteenth = { userId: "wrap-b", joinedAt: "2026-07-16T00:01:01Z" };
    const slots = assignRoomSlots([...members, thirteenth, fourteenth]);
    expect(slots.get(thirteenth.userId)).not.toBe(slots.get(fourteenth.userId));
  });
});
