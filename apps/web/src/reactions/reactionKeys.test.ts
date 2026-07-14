// The reaction keyboard map as pure transforms (Wave 7.3), the sibling of input/actions.test.ts.
// Each case pins one rule the spec or the owner rulings (2026-07-14) fix for the `/` leader HUD,
// the direct keys, and the captured-key hold behavior. Wave 8.4: the reducer takes the sender's
// resolved personal set, so the suite runs against the resolved defaults (🔥 on w/!, 🤔 on e/?)
// and pins that the `!`/`?` accelerators fire whatever slots 1 and 2 hold (PROTOCOL.md §9).
import { describe, expect, it } from "vitest";
import {
  HUD_CLOSED,
  REACTION_KEYS_IDLE,
  reactionKeyDown,
  reactionKeyUp,
} from "./reactionKeys";
import type { ReactionKeyState } from "./reactionKeys";
import {
  DEFAULT_RESOLVED_REACTION_SET,
  resolveReactionSet,
} from "./reactionSet";

const SET = DEFAULT_RESOLVED_REACTION_SET;

const OPEN_AT_5: ReactionKeyState = {
  hud: { open: true, cell: 5 },
  captured: null,
};

describe("reaction key handling (Wave 7.3)", () => {
  it("leader open: `/` opens the HUD anchored to the cursor cell and consumes the key", () => {
    const r = reactionKeyDown(SET, REACTION_KEYS_IDLE, "/", 7, false);
    expect(r.state.hud).toEqual({ open: true, cell: 7 });
    expect(r.fire).toBeNull();
    expect(r.consumed).toBe(true);
  });

  it("mapped fire: fires at the HUD's anchor cell and closes the HUD (owner ruling: fire-and-dismiss)", () => {
    // The anchor is the HUD's cell (5), not the passed current cell (9): the ring froze at open.
    const r = reactionKeyDown(SET, OPEN_AT_5, "w", 9, false);
    expect(r.fire).toEqual({ emoji: "🔥", cell: 5 });
    expect(r.state.hud).toEqual(HUD_CLOSED);
    expect(r.consumed).toBe(true);
  });

  it("mapped fire captures the key until keyup, so held auto-repeat fires reactions, never letters", () => {
    const fired = reactionKeyDown(SET, OPEN_AT_5, "w", 9, false);
    expect(fired.state.captured).toEqual({ key: "w", emoji: "🔥", cell: 5 });
    // The held key's auto-repeats: HUD stays gone, each repeat fires at the captured anchor and
    // is consumed, so no `W` ever reaches the grid mid-hold.
    const repeat = reactionKeyDown(SET, fired.state, "w", 9, true);
    expect(repeat.fire).toEqual({ emoji: "🔥", cell: 5 });
    expect(repeat.consumed).toBe(true);
    expect(repeat.state.hud).toEqual(HUD_CLOSED);
    expect(repeat.state.captured).toEqual(fired.state.captured);
  });

  it("keyup releases the captured key back to normal typing", () => {
    const fired = reactionKeyDown(SET, OPEN_AT_5, "w", 9, false);
    const released = reactionKeyUp(SET, fired.state, "w");
    expect(released.captured).toBeNull();
    // A fresh press of the same key now types as a letter.
    const after = reactionKeyDown(SET, released, "w", 9, false);
    expect(after.consumed).toBe(false);
    expect(after.fire).toBeNull();
  });

  it("a keyup of some other key leaves the capture standing", () => {
    const fired = reactionKeyDown(SET, OPEN_AT_5, "w", 9, false);
    expect(reactionKeyUp(SET, fired.state, "q")).toBe(fired.state);
  });

  it("a NON-repeat keydown of the captured key means keyup was missed: release and pass through", () => {
    const fired = reactionKeyDown(SET, OPEN_AT_5, "w", 9, false);
    const r = reactionKeyDown(SET, fired.state, "w", 9, false);
    expect(r.consumed).toBe(false);
    expect(r.fire).toBeNull();
    expect(r.state.captured).toBeNull();
  });

  it("capture matches case-folded (INV-1): a shift mid-hold still fires, and keyup of `W` releases", () => {
    const fired = reactionKeyDown(SET, OPEN_AT_5, "w", 9, false);
    const repeat = reactionKeyDown(SET, fired.state, "W", 9, true);
    expect(repeat.fire).toEqual({ emoji: "🔥", cell: 5 });
    expect(repeat.consumed).toBe(true);
    expect(reactionKeyUp(SET, fired.state, "W").captured).toBeNull();
  });

  it("held `/` repeats never reopen the HUD a fire just closed (hold-chord burst)", () => {
    // Hold `/`, press `w`: fires and closes. The still-held `/` keeps repeating.
    const fired = reactionKeyDown(SET, OPEN_AT_5, "w", 9, false);
    const slashRepeat = reactionKeyDown(SET, fired.state, "/", 9, true);
    expect(slashRepeat.state.hud).toEqual(HUD_CLOSED);
    expect(slashRepeat.consumed).toBe(true);
    expect(slashRepeat.fire).toBeNull();
  });

  it("held `/` repeats do not flicker an open HUD shut mid-hold", () => {
    const r = reactionKeyDown(SET, OPEN_AT_5, "/", 5, true);
    expect(r.state).toBe(OPEN_AT_5);
    expect(r.consumed).toBe(true);
    expect(r.fire).toBeNull();
  });

  it("a deliberate second `/` (not a repeat) closes the HUD", () => {
    const r = reactionKeyDown(SET, OPEN_AT_5, "/", 5, false);
    expect(r.state.hud).toEqual(HUD_CLOSED);
    expect(r.consumed).toBe(true);
  });

  it("mapped fire is ASCII case-folded (INV-1): a shifted `W` still fires slot 1", () => {
    const r = reactionKeyDown(SET, OPEN_AT_5, "W", 5, false);
    expect(r.fire).toEqual({ emoji: "🔥", cell: 5 });
  });

  it("unmapped pass-through: an unmapped key closes the HUD AND passes through as a letter", () => {
    const r = reactionKeyDown(SET, OPEN_AT_5, "q", 5, false);
    expect(r.state.hud).toEqual(HUD_CLOSED);
    expect(r.fire).toBeNull();
    // consumed=false is the whole point: an accidental `/` must never swallow the next keystroke.
    expect(r.consumed).toBe(false);
  });

  it("Esc closes the HUD and fires nothing", () => {
    const r = reactionKeyDown(SET, OPEN_AT_5, "Escape", 5, false);
    expect(r.state.hud).toEqual(HUD_CLOSED);
    expect(r.fire).toBeNull();
    expect(r.consumed).toBe(true);
  });

  it("direct keys fire with no HUD: `!` fires slot 1 (🔥) and `?` fires slot 2 (🤔) by default (PROTOCOL.md §9)", () => {
    const think = reactionKeyDown(SET, REACTION_KEYS_IDLE, "?", 2, false);
    expect(think.fire).toEqual({ emoji: "🤔", cell: 2 });
    expect(think.state.hud).toEqual(HUD_CLOSED);
    expect(think.consumed).toBe(true);

    const fire = reactionKeyDown(SET, REACTION_KEYS_IDLE, "!", 2, false);
    expect(fire.fire).toEqual({ emoji: "🔥", cell: 2 });
  });

  it("a direct key also dismisses an open HUD as it fires", () => {
    const r = reactionKeyDown(SET, OPEN_AT_5, "!", 9, false);
    expect(r.fire).toEqual({ emoji: "🔥", cell: 9 });
    expect(r.state.hud).toEqual(HUD_CLOSED);
  });

  it("a leader key with the HUD closed is not a reaction key: it passes through as a letter", () => {
    const r = reactionKeyDown(SET, REACTION_KEYS_IDLE, "w", 3, false);
    expect(r.fire).toBeNull();
    expect(r.consumed).toBe(false);
    expect(r.state).toBe(REACTION_KEYS_IDLE);
  });

  it("a personal set rides the keys: `!`/`?` fire whatever slots 1 and 2 hold, and W fires slot 1 (PROTOCOL.md §9)", () => {
    const custom = resolveReactionSet(["🧠", "✨", "👏", "🥳", "😤"]);
    const bang = reactionKeyDown(custom, REACTION_KEYS_IDLE, "!", 4, false);
    expect(bang.fire).toEqual({ emoji: "🧠", cell: 4 });
    const question = reactionKeyDown(custom, REACTION_KEYS_IDLE, "?", 4, false);
    expect(question.fire).toEqual({ emoji: "✨", cell: 4 });
    const mapped = reactionKeyDown(custom, OPEN_AT_5, "w", 9, false);
    expect(mapped.fire).toEqual({ emoji: "🧠", cell: 5 });
    // The capture carries the slot's current emoji, so a held burst stays the personal pick.
    expect(mapped.state.captured).toEqual({ key: "w", emoji: "🧠", cell: 5 });
  });
});
