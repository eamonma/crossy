// Roster port pin. The canonical source is apps/ios/Sources/CrossyDesign/IdentityRoster.swift (its
// header carries the ratification note); this suite proves the TypeScript port reproduces the
// twelve dark-ground values and the slot rule byte for byte, so the pushed puck color matches what
// the widget would draw. It also pins the cluster rule (RosterList.swift) and the initial rule
// (GridPresence.swift). Test names cite the invariant / the canonical file they defend.

import { describe, expect, it } from "vitest";
import { colorForUser } from "@crossy/protocol";
import {
  ROSTER_DARK_GROUND,
  clusterPucks,
  darkGroundForWireColor,
  orderedMembers,
  puckFromMember,
  puckInitial,
  slotForWireColor,
} from "./roster";
import type { RosterMember } from "./roster";

// The twelve dark-ground values, in slot order, verbatim from IdentityRoster.swift's `colors`
// array: [violet, poppy, teal, magenta, ochre, cobalt, moss, rust, plum, cyan, coral, slate], each
// entry's `darkGround`. If IdentityRoster.swift changes a value, this array must change with it (the
// port cites the canonical, it does not fork).
const CANONICAL_DARK_GROUND: readonly [number, number, number][] = [
  [0x9d, 0x95, 0xff], // violet
  [0xff, 0x7a, 0x50], // poppy
  [0x3b, 0xc7, 0xb4], // teal
  [0xe0, 0x6b, 0x9e], // magenta
  [0xe0, 0xa9, 0x3e], // ochre
  [0x6e, 0x93, 0xe8], // cobalt
  [0x90, 0xb4, 0x5e], // moss
  [0xd9, 0x78, 0x62], // rust
  [0xb2, 0x78, 0xc6], // plum
  [0x4f, 0xbc, 0xce], // cyan
  [0xf4, 0x91, 0x7f], // coral
  [0x8c, 0x99, 0xba], // slate
];

describe("roster port: the twelve dark-ground values (IdentityRoster.swift canonical)", () => {
  it("holds exactly twelve slots in the ratified order", () => {
    expect(ROSTER_DARK_GROUND).toHaveLength(12);
  });

  it("reproduces every dark-ground RGB triple byte for byte", () => {
    ROSTER_DARK_GROUND.forEach((rgb, slot) => {
      const [r, g, b] = CANONICAL_DARK_GROUND[slot]!;
      expect([rgb.red, rgb.green, rgb.blue]).toEqual([r, g, b]);
    });
  });

  it("every component is an 8-bit sRGB value (0-255), the payload's byte domain", () => {
    for (const rgb of ROSTER_DARK_GROUND) {
      for (const c of [rgb.red, rgb.green, rgb.blue]) {
        expect(Number.isInteger(c)).toBe(true);
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe("roster port: slot(forWireColor) rule (IdentityRoster.slot(forWireColor:))", () => {
  it("takes the 24-bit hex value mod 12", () => {
    // #000000 -> 0 mod 12 = 0; #00000C -> 12 mod 12 = 0; #00000D -> 13 mod 12 = 1.
    expect(slotForWireColor("#000000")).toBe(0);
    expect(slotForWireColor("#00000C")).toBe(0);
    expect(slotForWireColor("#00000D")).toBe(1);
    // #FFFFFF -> 16777215 mod 12 = 3.
    expect(slotForWireColor("#FFFFFF")).toBe(16777215 % 12);
  });

  it("folds hex case bytewise, no locale (INV-1)", () => {
    expect(slotForWireColor("#abcdef")).toBe(slotForWireColor("#ABCDEF"));
    expect(slotForWireColor("#AbCdEf")).toBe(slotForWireColor("#ABCDEF"));
  });

  it("returns null for anything but # plus six ASCII hex digits", () => {
    expect(slotForWireColor("")).toBeNull();
    expect(slotForWireColor("#FFF")).toBeNull();
    expect(slotForWireColor("FFFFFF")).toBeNull();
    expect(slotForWireColor("#GGGGGG")).toBeNull();
    expect(slotForWireColor("#FFFFFFF")).toBeNull();
  });

  it("darkGroundForWireColor returns the slot's dark-ground color", () => {
    const slot = slotForWireColor("#00000D")!;
    expect(darkGroundForWireColor("#00000D")).toEqual(ROSTER_DARK_GROUND[slot]);
    expect(darkGroundForWireColor("nope")).toBeNull();
  });
});

describe("roster port: the wire color the session derives slots to its own color", () => {
  it("puckFromMember colors a member by colorForUser's wire string (round trip)", () => {
    // The session's colorForUser produces the #RRGGBB the wire carries; slotting from it is what
    // keeps the pushed puck on the same slot the client would pick from the §4 participant color.
    const userId = "11111111-2222-3333-4444-555555555555";
    const wire = colorForUser(userId);
    const expected = darkGroundForWireColor(wire)!;
    const puck = puckFromMember({
      userId,
      displayName: "Ada",
      wireColor: wire,
      isSpectator: false,
      connected: true,
    });
    expect([puck.red, puck.green, puck.blue]).toEqual([
      expected.red,
      expected.green,
      expected.blue,
    ]);
  });

  it("falls back to the user-id hash slot when the wire color is unparseable", () => {
    const userId = "abcdef00-1111-2222-3333-444444444444";
    // The fallback must equal slotting colorForUser(userId): the session's own derivation.
    const viaWire = darkGroundForWireColor(colorForUser(userId))!;
    const puck = puckFromMember({
      userId,
      displayName: "Bo",
      wireColor: "", // unparseable, forces the fallback
      isSpectator: false,
      connected: true,
    });
    expect([puck.red, puck.green, puck.blue]).toEqual([
      viaWire.red,
      viaWire.green,
      viaWire.blue,
    ]);
  });
});

describe("roster port: initial rule (GridPresence.initial(of:), INV-1)", () => {
  it("ASCII-uppercases the first character", () => {
    expect(puckInitial("ada")).toBe("A");
    expect(puckInitial("Bob")).toBe("B");
    expect(puckInitial("zed")).toBe("Z");
  });

  it("is empty for an empty name", () => {
    expect(puckInitial("")).toBe("");
  });

  it("passes a non-ASCII first character through verbatim (no locale folding)", () => {
    // Swift's initial(of:) uppercases only the ASCII range bytewise; a non-ASCII scalar is left
    // whole. A leading 'é' (U+00E9) stays as-is, never folded to 'É'.
    expect(puckInitial("émile")).toBe("é");
  });
});

describe("roster port: cluster rule (RosterList.cluster / .ordered, ruling 2026-07-10)", () => {
  const member = (
    over: Partial<RosterMember> & { userId: string },
  ): RosterMember => ({
    displayName: over.userId,
    wireColor: "#000000",
    isSpectator: false,
    connected: true,
    ...over,
  });

  it("excludes spectators: only host and solver become pucks (presence ruling)", () => {
    const pucks = clusterPucks([
      member({ userId: "AA", displayName: "Ann", isSpectator: false }),
      member({ userId: "BB", displayName: "Bea", isSpectator: true }),
    ]);
    expect(pucks).toHaveLength(1);
    expect(pucks[0]!.initial).toBe("A");
  });

  it("orders connected before away, then by name, then by id (ASCII bytes)", () => {
    const ordered = orderedMembers([
      member({ userId: "z", displayName: "Zoe", connected: true }),
      member({ userId: "a", displayName: "Ann", connected: false }),
      member({ userId: "m", displayName: "Moe", connected: true }),
    ]);
    // Connected first (Zoe, Moe by name -> Moe before Zoe), then away (Ann).
    expect(ordered.map((m) => m.displayName)).toEqual(["Moe", "Zoe", "Ann"]);
  });

  it("breaks a name tie by user id in ASCII byte order", () => {
    const ordered = orderedMembers([
      member({ userId: "u2", displayName: "Sam" }),
      member({ userId: "u1", displayName: "Sam" }),
    ]);
    expect(ordered.map((m) => m.userId)).toEqual(["u1", "u2"]);
  });

  it("caps the cluster at four, dropping the rest (RosterList.puckCap)", () => {
    const many = ["Ann", "Bea", "Cal", "Dan", "Eve", "Fin"].map((n, i) =>
      member({ userId: `u${i}`, displayName: n }),
    );
    const pucks = clusterPucks(many);
    expect(pucks).toHaveLength(4);
    expect(pucks.map((p) => p.initial)).toEqual(["A", "B", "C", "D"]);
  });

  it("carries each member's connected flag for away-dimming", () => {
    const pucks = clusterPucks([
      member({ userId: "AA", displayName: "Ann", connected: true }),
      member({ userId: "BB", displayName: "Bea", connected: false }),
    ]);
    expect(pucks.map((p) => p.connected)).toEqual([true, false]);
  });

  it("INV-6 carries each member's opaque userId (the avatar-art key, never board content)", () => {
    // The opaque id passes straight through, the same value the §4 participant payload carries; it
    // is the widget's local avatar-cache key and reveals nothing toward the solution.
    const pucks = clusterPucks([
      member({ userId: "AA", displayName: "Ann" }),
      member({ userId: "BB", displayName: "Bea" }),
    ]);
    expect(pucks.map((p) => p.userId)).toEqual(["AA", "BB"]);
  });
});
