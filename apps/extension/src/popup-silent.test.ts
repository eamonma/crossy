import { describe, expect, it } from "vitest";
import type { SilentSignInReply } from "./auth/messages";
import { silentSignInThenRender } from "./popup-silent";

/** Record which render path ran, in order, plus whether checking showed first. */
function recorder() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      showChecking: () => calls.push("checking"),
      onSignedIn: () => calls.push("signed-in"),
      onSignedOut: () => calls.push("signed-out"),
    },
  };
}

// An immediate setTimeout so the timeout leg resolves without real time; the race
// still lets a resolved request win when it resolves in the same microtask flush.
const immediate = ((fn: () => void) => {
  Promise.resolve().then(fn);
  return 0;
}) as unknown as typeof setTimeout;

describe("silentSignInThenRender", () => {
  it("shows checking first, then renders signed-in on an ok reply", async () => {
    const { calls, deps } = recorder();
    await silentSignInThenRender({
      ...deps,
      requestSilent: () => Promise.resolve({ ok: true }),
      timeoutMs: 4000,
    });
    expect(calls).toEqual(["checking", "signed-in"]);
  });

  it("renders the buttons on a failed reply", async () => {
    const { calls, deps } = recorder();
    await silentSignInThenRender({
      ...deps,
      requestSilent: () => Promise.resolve({ ok: false }),
      timeoutMs: 4000,
    });
    expect(calls).toEqual(["checking", "signed-out"]);
  });

  it("falls back to buttons when the request rejects (worker unreachable)", async () => {
    const { calls, deps } = recorder();
    await silentSignInThenRender({
      ...deps,
      requestSilent: () => Promise.reject(new Error("no worker")),
      timeoutMs: 4000,
    });
    expect(calls).toEqual(["checking", "signed-out"]);
  });

  it("falls back to buttons when the request hangs past the timeout", async () => {
    const { calls, deps } = recorder();
    await silentSignInThenRender({
      ...deps,
      // Never resolves: only the timeout can settle the race.
      requestSilent: () => new Promise<SilentSignInReply>(() => undefined),
      timeoutMs: 1,
      setTimeoutFn: immediate,
    });
    expect(calls).toEqual(["checking", "signed-out"]);
  });
});
