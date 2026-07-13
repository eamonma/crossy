// Pins web's identity palette to the cross-client contract (DESIGN.md §8,
// vectors/identity/roster.json). If web's IDENTITY_ROSTER or its bucketing ever drifts from the
// frozen slots, this fails. The vector is language-neutral ground apps/session and iOS pin against
// too, so a green run here means one player reads as one color on every surface.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IDENTITY_ROSTER,
  identityColor,
  slotForWireColor,
} from "./identityRoster";

const here = dirname(fileURLToPath(import.meta.url));
const vector = JSON.parse(
  readFileSync(
    resolve(here, "../../../../vectors/identity/roster.json"),
    "utf8",
  ),
) as {
  slots: { slot: number; name: string; light: string; dark: string }[];
  slotForWireColor: { wire: string; slot: number }[];
};

describe("identity palette matches the cross-client vector (DESIGN.md §8)", () => {
  it("carries exactly the frozen slots, in order, with both ground variants", () => {
    expect(IDENTITY_ROSTER).toHaveLength(vector.slots.length);
    vector.slots.forEach((slot, i) => {
      expect(slot.slot).toBe(i); // the vector lists slots in index order
      expect(IDENTITY_ROSTER[i]).toEqual({
        name: slot.name,
        light: slot.light,
        dark: slot.dark,
      });
    });
  });

  it("buckets each wire color to the slot the vector pins (value % 12)", () => {
    for (const { wire, slot } of vector.slotForWireColor) {
      expect(slotForWireColor(wire)).toBe(slot);
    }
  });
});

describe("slotForWireColor (ASCII hex only, INV-1)", () => {
  it("accepts lower and upper case hex as the same slot (no locale casing)", () => {
    expect(slotForWireColor("#abcdef")).toBe(slotForWireColor("#ABCDEF"));
  });

  it("returns null for a malformed wire color rather than a wrong slot", () => {
    expect(slotForWireColor("")).toBeNull();
    expect(slotForWireColor("#12345")).toBeNull(); // too short
    expect(slotForWireColor("123456")).toBeNull(); // no '#'
    expect(slotForWireColor("#12345g")).toBeNull(); // non-hex digit
  });
});

describe("identityColor (resolve a wire color to the painted hex per ground)", () => {
  it("paints the slot's light variant on a light ground and the dark on a dark ground", () => {
    // #123456 buckets to slot 6 (moss).
    expect(identityColor("#123456", false)).toBe(IDENTITY_ROSTER[6]!.light);
    expect(identityColor("#123456", true)).toBe(IDENTITY_ROSTER[6]!.dark);
  });

  it("falls back to the given string when it cannot bucket (never crashes a paint)", () => {
    expect(identityColor("not-a-color", false)).toBe("not-a-color");
  });
});
