// Session-lifetime negative cache for avatar srcs. PROTOCOL.md section 4 treats a
// load error as absence (the fallback initial renders), but Radix re-attempts the
// load on every mount, so a known-missing avatar refetches forever across roster,
// toolbar, and check-vote remounts. The store remembers the failure once per session.
import { describe, expect, it, vi } from "vitest";
import { createAvatarLoadFailureStore } from "./avatar-load-failures";

describe("avatar load failure store", () => {
  it("reports an unrecorded src as not failed", () => {
    const store = createAvatarLoadFailureStore();
    expect(store.hasFailed("https://example.com/a.png")).toBe(false);
  });

  it("reports a recorded failure", () => {
    const store = createAvatarLoadFailureStore();
    store.recordFailure("https://example.com/a.png");
    expect(store.hasFailed("https://example.com/a.png")).toBe(true);
    expect(store.hasFailed("https://example.com/b.png")).toBe(false);
  });

  it("notifies subscribers when a failure is recorded", () => {
    const store = createAvatarLoadFailureStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.recordFailure("https://example.com/a.png");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not re-notify on a duplicate record", () => {
    const store = createAvatarLoadFailureStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.recordFailure("https://example.com/a.png");
    store.recordFailure("https://example.com/a.png");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createAvatarLoadFailureStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.recordFailure("https://example.com/a.png");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("default singleton bindings", () => {
  it("share one module-level store", async () => {
    const {
      recordAvatarLoadFailure,
      hasAvatarLoadFailed,
      subscribeAvatarLoadFailures,
    } = await import("./avatar-load-failures");
    const listener = vi.fn();
    const unsubscribe = subscribeAvatarLoadFailures(listener);
    expect(hasAvatarLoadFailed("https://example.com/singleton.png")).toBe(
      false,
    );
    recordAvatarLoadFailure("https://example.com/singleton.png");
    expect(hasAvatarLoadFailed("https://example.com/singleton.png")).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
