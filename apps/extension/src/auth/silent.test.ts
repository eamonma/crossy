import { describe, expect, it } from "vitest";
import type { SilentSignInReply } from "./messages";
import { SilentSignIn } from "./silent";

/** A deferred so a test can hold an attempt in flight and resolve it on demand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("SilentSignIn single-flight", () => {
  it("runs the attempt once when clear and returns its reply", async () => {
    let attempts = 0;
    const silent = new SilentSignIn({
      interactiveInFlight: () => false,
      alreadySignedIn: () => Promise.resolve(false),
      attempt: () => {
        attempts += 1;
        return Promise.resolve({ ok: true });
      },
    });
    expect(await silent.run()).toEqual({ ok: true });
    expect(attempts).toBe(1);
  });

  it("a second run() while one is in flight shares the first, one attempt only", async () => {
    let attempts = 0;
    const gate = deferred<SilentSignInReply>();
    const silent = new SilentSignIn({
      interactiveInFlight: () => false,
      alreadySignedIn: () => Promise.resolve(false),
      attempt: () => {
        attempts += 1;
        return gate.promise;
      },
    });
    const first = silent.run();
    const second = silent.run();
    // Both callers hold the same in-flight promise.
    gate.resolve({ ok: true });
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(attempts).toBe(1);
  });

  it("clears in-flight after settling, so a later run() attempts again", async () => {
    let attempts = 0;
    const silent = new SilentSignIn({
      interactiveInFlight: () => false,
      alreadySignedIn: () => Promise.resolve(false),
      attempt: () => {
        attempts += 1;
        return Promise.resolve({ ok: false });
      },
    });
    await silent.run();
    await silent.run();
    expect(attempts).toBe(2);
  });

  it("stands down without attempting while an interactive sign-in is in flight", async () => {
    let attempts = 0;
    const silent = new SilentSignIn({
      interactiveInFlight: () => true,
      alreadySignedIn: () => Promise.resolve(false),
      attempt: () => {
        attempts += 1;
        return Promise.resolve({ ok: true });
      },
    });
    expect(await silent.run()).toEqual({ ok: false });
    expect(attempts).toBe(0);
  });

  it("stands down without attempting when already signed in", async () => {
    let attempts = 0;
    const silent = new SilentSignIn({
      interactiveInFlight: () => false,
      alreadySignedIn: () => Promise.resolve(true),
      attempt: () => {
        attempts += 1;
        return Promise.resolve({ ok: true });
      },
    });
    expect(await silent.run()).toEqual({ ok: false });
    expect(attempts).toBe(0);
  });

  it("resolves failed and never throws when the attempt throws (nothing to lose)", async () => {
    const silent = new SilentSignIn({
      interactiveInFlight: () => false,
      alreadySignedIn: () => Promise.resolve(false),
      attempt: () => Promise.reject(new Error("boom")),
    });
    await expect(silent.run()).resolves.toEqual({ ok: false });
  });
});
