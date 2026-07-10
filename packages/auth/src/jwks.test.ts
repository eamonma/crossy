// The JWKS adapter as implementation #2 of the shared contract, plus the SP2
// mechanics the adapter owns: derived JWKS URL, boot fetch, background refresh, rotation
// overlap (old key verifies until dropped), unknown-kid fails closed and triggers exactly
// one debounced refresh, keep-last-good on fetch failure, and zero network on the verify
// path. The fake provider is the token minter; a manual scheduler makes timers
// deterministic. No real network anywhere (SP2 zero-network property stays testable).

import { describe, expect, it, vi } from "vitest";
import { createFakeAuthProvider } from "./fake";
import {
  createJwksAuthPort,
  deriveJwksUri,
  type Scheduler,
  type TimerHandle,
} from "./jwks";
import {
  runAuthPortContract,
  type AuthPortContractHarness,
} from "./port-contract";

const FIXED_NOW = new Date("2026-07-08T00:00:00.000Z");
const ISSUER = "https://project-ref.supabase.co/auth/v1";
const AUDIENCE = "authenticated";
const SKEW = 10;

/** A scheduler whose timers fire only when the test says so. */
class ManualScheduler implements Scheduler {
  private timeouts: Array<() => void> = [];
  private intervals: Array<() => void> = [];
  timeoutCount = 0;
  intervalCount = 0;

  setTimeout(fn: () => void): TimerHandle {
    this.timeoutCount++;
    this.timeouts.push(fn);
    return {
      cancel: () => {
        this.timeouts = this.timeouts.filter((f) => f !== fn);
      },
    };
  }
  setInterval(fn: () => void): TimerHandle {
    this.intervalCount++;
    this.intervals.push(fn);
    return {
      cancel: () => {
        this.intervals = this.intervals.filter((f) => f !== fn);
      },
    };
  }
  fireTimeouts(): void {
    const pending = this.timeouts;
    this.timeouts = [];
    for (const fn of pending) fn();
  }
  fireIntervals(): void {
    for (const fn of [...this.intervals]) fn();
  }
}

/** Let a fired timer's fire-and-forget `refreshNow()` promise settle (real microtasks). */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function makeAdapterHarness(): Promise<AuthPortContractHarness> {
  const idp = await createFakeAuthProvider({
    issuer: ISSUER,
    audience: AUDIENCE,
    clockToleranceSec: SKEW,
    now: () => FIXED_NOW,
  });
  const adapter = await createJwksAuthPort({
    issuer: ISSUER,
    audience: AUDIENCE,
    clockToleranceSec: SKEW,
    now: () => FIXED_NOW,
    fetchJwks: () => Promise.resolve(idp.jwks()),
  });
  return {
    label: "jwks-adapter",
    port: adapter,
    issuer: ISSUER,
    audience: AUDIENCE,
    clockToleranceSec: SKEW,
    mint: idp.mint,
    mintUnknownKid: idp.mintUnknownKid,
    mintBadSignature: idp.mintBadSignature,
    mintHs256: idp.mintHs256,
  };
}

runAuthPortContract(makeAdapterHarness);

describe("jwks adapter mechanics (SP2)", () => {
  it("derives the JWKS URL from the issuer", () => {
    expect(deriveJwksUri("http://127.0.0.1:54321/auth/v1")).toBe(
      "http://127.0.0.1:54321/auth/v1/.well-known/jwks.json",
    );
    expect(deriveJwksUri("https://p.supabase.co/auth/v1/")).toBe(
      "https://p.supabase.co/auth/v1/.well-known/jwks.json",
    );
  });

  it("fetches the derived JWKS URL once on boot", async () => {
    const idp = await createFakeAuthProvider({ issuer: ISSUER });
    const fetchJwks = vi.fn((uri: string) => {
      expect(uri).toBe(
        "https://project-ref.supabase.co/auth/v1/.well-known/jwks.json",
      );
      return Promise.resolve(idp.jwks());
    });
    await createJwksAuthPort({ issuer: ISSUER, fetchJwks });
    expect(fetchJwks).toHaveBeenCalledTimes(1);
  });

  it("rejects construction when the boot fetch fails (cannot verify without keys)", async () => {
    await expect(
      createJwksAuthPort({
        issuer: ISSUER,
        fetchJwks: () => Promise.reject(new Error("boot")),
      }),
    ).rejects.toThrow("boot");
  });

  it("never fetches on the verify path (SP2 zero network)", async () => {
    const idp = await createFakeAuthProvider({
      issuer: ISSUER,
      now: () => FIXED_NOW,
    });
    const fetchJwks = vi.fn(() => Promise.resolve(idp.jwks()));
    const adapter = await createJwksAuthPort({
      issuer: ISSUER,
      now: () => FIXED_NOW,
      fetchJwks,
    });
    expect(fetchJwks).toHaveBeenCalledTimes(1); // boot only

    for (let i = 0; i < 5; i++) await adapter.verify(await idp.mint());
    await adapter.verify(await idp.mintExpired());
    await adapter.verify("garbage");
    await adapter.verify(await idp.mintBadSignature());

    expect(fetchJwks).toHaveBeenCalledTimes(1); // verify added no fetches
    adapter.stop();
  });

  it("verifies an old key until it is dropped across rotation (SP2 overlap)", async () => {
    const idp = await createFakeAuthProvider({
      issuer: ISSUER,
      now: () => FIXED_NOW,
    });
    const adapter = await createJwksAuthPort({
      issuer: ISSUER,
      now: () => FIXED_NOW,
      fetchJwks: () => Promise.resolve(idp.jwks()),
    });

    const oldKid = idp.currentKid();
    const oldToken = await idp.mint({ sub: "u" });
    expect((await adapter.verify(oldToken)).ok).toBe(true);

    await idp.rotate();
    const newToken = await idp.mint({ sub: "u" });

    // Before the adapter refreshes, the new key is unknown but the old one still verifies.
    expect(await adapter.verify(newToken)).toEqual({
      ok: false,
      reason: "unknown-key",
    });
    expect((await adapter.verify(oldToken)).ok).toBe(true);

    await adapter.refreshNow();
    expect((await adapter.verify(oldToken)).ok).toBe(true); // overlap: both verify
    expect((await adapter.verify(newToken)).ok).toBe(true);

    idp.revokeKey(oldKid);
    await adapter.refreshNow();
    expect(await adapter.verify(oldToken)).toEqual({
      ok: false,
      reason: "unknown-key",
    }); // dropped
    expect((await adapter.verify(newToken)).ok).toBe(true);
    adapter.stop();
  });

  it("fails closed on unknown kid and triggers exactly one debounced refresh (SP2)", async () => {
    const idp = await createFakeAuthProvider({
      issuer: ISSUER,
      now: () => FIXED_NOW,
    });
    const scheduler = new ManualScheduler();
    const fetchJwks = vi.fn(() => Promise.resolve(idp.jwks()));
    const adapter = await createJwksAuthPort({
      issuer: ISSUER,
      now: () => FIXED_NOW,
      scheduler,
      fetchJwks,
      unknownKidRefreshDebounceMs: 5_000,
    });
    expect(fetchJwks).toHaveBeenCalledTimes(1); // boot

    await idp.rotate();
    const t1 = await idp.mint({ sub: "u" });
    const t2 = await idp.mint({ sub: "u" });

    expect(await adapter.verify(t1)).toEqual({
      ok: false,
      reason: "unknown-key",
    });
    expect(await adapter.verify(t2)).toEqual({
      ok: false,
      reason: "unknown-key",
    });

    // A burst of unknown kids schedules exactly one refresh and never fetches inline.
    expect(scheduler.timeoutCount).toBe(1);
    expect(fetchJwks).toHaveBeenCalledTimes(1);

    scheduler.fireTimeouts();
    await flush();

    expect(fetchJwks).toHaveBeenCalledTimes(2); // the single debounced refresh ran
    expect((await adapter.verify(t1)).ok).toBe(true); // rotated key now trusted
    adapter.stop();
  });

  it("start schedules a background refresh that swaps the key set (SP2)", async () => {
    const idp = await createFakeAuthProvider({
      issuer: ISSUER,
      now: () => FIXED_NOW,
    });
    const scheduler = new ManualScheduler();
    const adapter = await createJwksAuthPort({
      issuer: ISSUER,
      now: () => FIXED_NOW,
      scheduler,
      fetchJwks: () => Promise.resolve(idp.jwks()),
      refreshIntervalMs: 60_000,
    });

    expect(scheduler.intervalCount).toBe(0);
    adapter.start();
    adapter.start(); // idempotent
    expect(scheduler.intervalCount).toBe(1);

    await idp.rotate();
    const token = await idp.mint({ sub: "u" });
    expect(await adapter.verify(token)).toEqual({
      ok: false,
      reason: "unknown-key",
    });

    scheduler.fireIntervals();
    await flush();

    expect((await adapter.verify(token)).ok).toBe(true);
    adapter.stop();
  });

  it("keeps the last-good key set when a refresh fetch fails (SP2)", async () => {
    const idp = await createFakeAuthProvider({
      issuer: ISSUER,
      now: () => FIXED_NOW,
    });
    let fail = false;
    const adapter = await createJwksAuthPort({
      issuer: ISSUER,
      now: () => FIXED_NOW,
      fetchJwks: () =>
        fail
          ? Promise.reject(new Error("network"))
          : Promise.resolve(idp.jwks()),
    });
    const token = await idp.mint({ sub: "u" });
    expect((await adapter.verify(token)).ok).toBe(true);

    fail = true;
    await adapter.refreshNow(); // swallows, retains last-good
    expect((await adapter.verify(token)).ok).toBe(true);
    adapter.stop();
  });

  it("reads the anonymity flag from a configured custom claim name (SP2: the claim is config, not a literal)", async () => {
    // The minter writes `anon_flag`, not `is_anonymous`; the adapter reads the same
    // configured name. If the verifier still read a hardcoded `is_anonymous`, the token
    // would carry no such claim and isAnonymous would default to false, so a `true` here
    // proves the claim name flows from config through to the mapping.
    const idp = await createFakeAuthProvider({
      issuer: ISSUER,
      now: () => FIXED_NOW,
      anonymousClaim: "anon_flag",
    });
    const adapter = await createJwksAuthPort({
      issuer: ISSUER,
      now: () => FIXED_NOW,
      anonymousClaim: "anon_flag",
      fetchJwks: () => Promise.resolve(idp.jwks()),
    });
    const result = await adapter.verify(await idp.mintAnonymous({ sub: "u" }));
    expect(result).toEqual({
      ok: true,
      identity: { userId: "u", isAnonymous: true },
    });
    adapter.stop();
  });
});
