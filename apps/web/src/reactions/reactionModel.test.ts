// The transient reaction model's behaviors (ROADMAP Phase 7 Wave 7.3), named by the PROTOCOL.md
// section or the Wave 7.3 rule they defend. Fake timers drive the decay clock and the rate-cap
// window; the model uses Date.now + setTimeout, both faked here, so the two stay in lockstep.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REACTION_DECAY_MS, ReactionModel } from "./reactionModel";

interface Sent {
  emoji: string;
  cell: number;
}

function makeModel(self = "me") {
  const sent: Sent[] = [];
  const model = new ReactionModel({
    send: (emoji, cell) => sent.push({ emoji, cell }),
    selfUserId: () => self,
  });
  return { model, sent };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("reaction model (PROTOCOL.md §9, Wave 7.3)", () => {
  it("local echo: a sent reaction lands at once, attributed to self, and rides the wire (§6)", () => {
    const { model, sent } = makeModel("me");
    const fired = model.send("🎉", 5);
    expect(fired).toBe(true);
    // The server never echoes to the sender (§6), so the client shows its own sticker itself.
    expect(sent).toEqual([{ emoji: "🎉", cell: 5 }]);
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]).toMatchObject({
      userId: "me",
      emoji: "🎉",
      cell: 5,
      pulse: 0,
    });
  });

  it("expiry: a sticker is gone exactly at REACTION_DECAY_MS (Wave 7.3 decay)", () => {
    const { model } = makeModel();
    model.send("🎉", 3);
    expect(model.entries).toHaveLength(1);
    vi.advanceTimersByTime(REACTION_DECAY_MS - 1);
    expect(model.entries).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(model.entries).toHaveLength(0);
  });

  it("coalescing: a sender's repeat of the same emoji+cell bumps pulse and refreshes the timer, no second sprite (§9)", () => {
    const { model } = makeModel();
    model.send("🎉", 3);
    vi.advanceTimersByTime(3000);
    model.send("🎉", 3); // coalesces onto the live sprite
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]?.pulse).toBe(1);
    // The original would have decayed at 5000; the refresh pushes it to 3000 + 5000 = 8000.
    vi.advanceTimersByTime(REACTION_DECAY_MS - 1); // 7999
    expect(model.entries).toHaveLength(1);
    vi.advanceTimersByTime(1); // 8000
    expect(model.entries).toHaveLength(0);
  });

  it("coalesce is per sender: the same emoji+cell from two users are two sprites (§9)", () => {
    const { model } = makeModel("me");
    model.send("🎉", 4);
    model.receive({ userId: "u2", emoji: "🎉", cell: 4 });
    expect(model.entries).toHaveLength(2);
  });

  it("receive-any: an incoming emoji outside the send set still renders and never sends (§9)", () => {
    const { model, sent } = makeModel();
    model.receive({ userId: "u2", emoji: "🔥", cell: 8 });
    expect(model.entries).toHaveLength(1);
    expect(model.entries[0]).toMatchObject({
      userId: "u2",
      emoji: "🔥",
      cell: 8,
    });
    expect(sent).toHaveLength(0);
  });

  it("client rate cap: at most 5 sends fire in a 1s window; the 6th is dropped locally with no frame (§9)", () => {
    const { model, sent } = makeModel();
    for (let cell = 0; cell < 5; cell += 1) {
      expect(model.send("🎉", cell)).toBe(true);
    }
    // The 6th within the window does not fire and lands no sticker: a silent local drop.
    expect(model.send("🎉", 99)).toBe(false);
    expect(sent).toHaveLength(5);
    expect(model.entries.map((e) => e.cell)).not.toContain(99);
  });

  it("the rate-cap window slides: a send resumes once a second has passed (§9)", () => {
    const { model, sent } = makeModel();
    for (let cell = 0; cell < 5; cell += 1) model.send("🎉", cell);
    expect(model.send("🎉", 5)).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(model.send("🎉", 6)).toBe(true);
    expect(sent).toHaveLength(6);
  });

  it("an inbound reaction never counts against the local send cap (§9)", () => {
    const { model } = makeModel();
    for (let i = 0; i < 10; i += 1) {
      model.receive({ userId: "u2", emoji: "🎉", cell: i });
    }
    for (let i = 0; i < 5; i += 1) {
      expect(model.send("🎉", 100 + i)).toBe(true);
    }
  });

  it("dispose clears pending decay timers and the sprite list (teardown)", () => {
    const { model } = makeModel();
    model.send("🎉", 1);
    model.dispose();
    expect(model.entries).toHaveLength(0);
    // No timer survives to fire after teardown.
    vi.advanceTimersByTime(REACTION_DECAY_MS * 2);
    expect(model.entries).toHaveLength(0);
  });
});
