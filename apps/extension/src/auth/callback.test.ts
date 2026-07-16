import { describe, expect, it } from "vitest";

import { PendingCaptures } from "./callback";

describe("PendingCaptures", () => {
  it("delivers a captured redirect to the tab's waiter", async () => {
    const pending = new PendingCaptures();
    const waiter = pending.register(7);
    expect(
      pending.deliver(7, "https://crossy.party/auth/ext/callback?code=abc"),
    ).toBe(true);
    await expect(waiter).resolves.toBe(
      "https://crossy.party/auth/ext/callback?code=abc",
    );
  });

  it("resolves undefined on cancel, so the attempt reads it as a cancel", async () => {
    const pending = new PendingCaptures();
    const waiter = pending.register(7);
    expect(pending.cancel(7)).toBe(true);
    await expect(waiter).resolves.toBeUndefined();
  });

  it("ignores deliver and cancel for a tab with no capture in flight", () => {
    const pending = new PendingCaptures();
    expect(
      pending.deliver(99, "https://crossy.party/auth/ext/callback?code=x"),
    ).toBe(false);
    expect(pending.cancel(99)).toBe(false);
  });

  it("a second register for a tab cancels the first, one capture pending per tab", async () => {
    const pending = new PendingCaptures();
    const first = pending.register(7);
    const second = pending.register(7);
    await expect(first).resolves.toBeUndefined();
    expect(
      pending.deliver(7, "https://crossy.party/auth/ext/callback?code=abc"),
    ).toBe(true);
    await expect(second).resolves.toBe(
      "https://crossy.party/auth/ext/callback?code=abc",
    );
  });

  it("only settles once: a deliver after the waiter resolved is a no-op", async () => {
    const pending = new PendingCaptures();
    const waiter = pending.register(7);
    expect(
      pending.deliver(7, "https://crossy.party/auth/ext/callback?code=abc"),
    ).toBe(true);
    await waiter;
    expect(
      pending.deliver(7, "https://crossy.party/auth/ext/callback?code=late"),
    ).toBe(false);
  });
});
