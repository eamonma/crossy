// The reconnect-overlay grace engine (Track A-web). The pill renders only after a non-live sync
// state has held continuously past the threshold, and hides immediately on recovery, so an edge
// proxy cycle (~200ms) never flashes it. Fake timers drive the grace clock; the engine uses
// setTimeout, faked here, the same idiom as reactionModel.test.ts (the node test env mounts no
// React, so the engine is tested framework-free).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDelayedFlag,
  RECONNECT_OVERLAY_GRACE_MS,
} from "./useDelayedFlag";

function makeFlag(delayMs = RECONNECT_OVERLAY_GRACE_MS) {
  const changes: boolean[] = [];
  const flag = createDelayedFlag(delayMs, (value) => changes.push(value));
  return { flag, changes, last: () => changes.at(-1) ?? false };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("reconnect overlay grace (Track A-web)", () => {
  it("below the threshold the flag never fires", () => {
    const { flag, changes } = makeFlag();
    flag.set(true);
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS - 1);
    expect(changes).toEqual([]);
  });

  it("past the threshold the flag fires exactly once, at the boundary", () => {
    const { flag, changes } = makeFlag();
    flag.set(true);
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true]);
  });

  it("deactivation resets immediately and cancels the timer", () => {
    const { flag, changes } = makeFlag();
    flag.set(true);
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS); // shown
    flag.set(false); // recovery hides at once
    expect(changes).toEqual([true, false]);
    // The cancelled timer never fires a stale re-show after recovery.
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS * 5);
    expect(changes).toEqual([true, false]);
  });

  it("a pending timer is cancelled when active clears before the threshold", () => {
    const { flag, changes } = makeFlag();
    flag.set(true);
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS - 1);
    flag.set(false); // an edge proxy cycle recovers inside the grace window
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS * 5);
    expect(changes).toEqual([]); // never rendered
  });

  it("a bounce across the threshold boundary restarts the grace window", () => {
    const { flag, changes } = makeFlag();
    flag.set(true);
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS - 10);
    flag.set(false); // recovered just before the boundary
    flag.set(true); // dropped again: a fresh full window, not the leftover 10ms
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true]);
  });

  it("repeating active while already active keeps one timer (the two non-live states share it)", () => {
    const { flag, changes } = makeFlag();
    flag.set(true); // resyncing
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS - 1);
    flag.set(true); // resyncing -> reconnecting: still active, no restart
    vi.advanceTimersByTime(1); // the original timer reaches the boundary
    expect(changes).toEqual([true]);
  });

  it("dispose cancels a pending timer", () => {
    const { flag, changes } = makeFlag();
    flag.set(true);
    flag.dispose();
    vi.advanceTimersByTime(RECONNECT_OVERLAY_GRACE_MS * 5);
    expect(changes).toEqual([]);
  });
});
