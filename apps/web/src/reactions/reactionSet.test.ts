// The derived reaction set (Wave 8.4; PROTOCOL.md §9, §12): resolveReactionSet builds the ordered
// options and key lookups from a personal set, or the defaults on null. Each case pins one contract
// rule: the default five in slot order, the fixed slot geometry riding whatever emoji fill it, the
// `!`/`?` accelerators on slots 1 and 2, and the case-folded lookups (INV-1).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_REACTION_SET,
  DEFAULT_RESOLVED_REACTION_SET,
  REACTION_SLOTS,
  optionForDirectKey,
  optionForLeaderKey,
  resolveReactionSet,
} from "./reactionSet";

const CUSTOM = ["🧠", "✨", "👏", "🥳", "😤"];

describe("resolveReactionSet (Wave 8.4, PROTOCOL.md §9/§12)", () => {
  it("null resolves to the default five in slot order (🔥 🤔 🐐 💀 😭, §9)", () => {
    const set = resolveReactionSet(null);
    expect(set.options.map((o) => o.emoji)).toEqual([
      "🔥",
      "🤔",
      "🐐",
      "💀",
      "😭",
    ]);
    expect(DEFAULT_REACTION_SET).toEqual(["🔥", "🤔", "🐐", "💀", "😭"]);
  });

  it("a personal set fills the slots in order, emoji only: keys, labels, and directions stay put", () => {
    const set = resolveReactionSet(CUSTOM);
    expect(set.options.map((o) => o.emoji)).toEqual(CUSTOM);
    // The positional metadata is byte-identical to the fixed slot table: only the emoji rides in.
    set.options.forEach((option, i) => {
      const meta = REACTION_SLOTS[i];
      expect(option.leaderKey).toBe(meta?.leaderKey);
      expect(option.keyLabel).toBe(meta?.keyLabel);
      expect(option.slot).toBe(meta?.slot);
      expect(option.directKey).toBe(meta?.directKey);
    });
  });

  it("the key labels ride the slots: W/E/D/S/A in slot order, whatever the emoji", () => {
    const set = resolveReactionSet(CUSTOM);
    expect(set.options.map((o) => o.keyLabel)).toEqual([
      "W",
      "E",
      "D",
      "S",
      "A",
    ]);
  });

  it("the accelerators sit on slots 1 and 2: `!` then `?`, and nowhere else (§9)", () => {
    const set = resolveReactionSet(CUSTOM);
    expect(set.options.map((o) => o.directKey)).toEqual([
      "!",
      "?",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("a wrong-length personal set resolves to the defaults (the render never shows a hole)", () => {
    expect(
      resolveReactionSet(["🔥", "🤔"]).options.map((o) => o.emoji),
    ).toEqual([...DEFAULT_REACTION_SET]);
    expect(resolveReactionSet([]).options.map((o) => o.emoji)).toEqual([
      ...DEFAULT_REACTION_SET,
    ]);
  });

  it("optionForLeaderKey resolves against the personal set, case-folded ASCII-only (INV-1)", () => {
    const set = resolveReactionSet(CUSTOM);
    expect(optionForLeaderKey(set, "w")?.emoji).toBe("🧠");
    expect(optionForLeaderKey(set, "W")?.emoji).toBe("🧠");
    expect(optionForLeaderKey(set, "a")?.emoji).toBe("😤");
    expect(optionForLeaderKey(set, "q")).toBeUndefined();
    // Multi-char key names (Escape, ArrowUp) are never leader keys.
    expect(optionForLeaderKey(set, "Escape")).toBeUndefined();
  });

  it("optionForDirectKey fires the slot contents: `!` is slot 1, `?` is slot 2 (§9)", () => {
    const set = resolveReactionSet(CUSTOM);
    expect(optionForDirectKey(set, "!")?.emoji).toBe("🧠");
    expect(optionForDirectKey(set, "?")?.emoji).toBe("✨");
    expect(optionForDirectKey(set, "x")).toBeUndefined();
    // And on the defaults: 🔥 and 🤔.
    expect(optionForDirectKey(DEFAULT_RESOLVED_REACTION_SET, "!")?.emoji).toBe(
      "🔥",
    );
    expect(optionForDirectKey(DEFAULT_RESOLVED_REACTION_SET, "?")?.emoji).toBe(
      "🤔",
    );
  });
});
