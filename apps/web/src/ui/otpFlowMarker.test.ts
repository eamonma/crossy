// The same-browser marker's contract (the confirm-route gate). A marker set when THIS browser
// started an email OTP flow is what lets /auth/confirm verify a magic link silently; its absence
// is what routes a cross-device link to guidance plus the escape hatch, never a silent verify. It
// carries no secret, guards for absent/throwing storage, and ages out after an hour.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearOtpFlowMarker,
  hasOtpFlowMarker,
  readOtpFlowMarker,
  setOtpFlowMarker,
} from "./otpFlowMarker";

// A minimal in-memory localStorage stand-in: the web suite runs under node (no jsdom), so the
// module reads globalThis.localStorage, which we install per test.
function installStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
  (globalThis as { localStorage?: Storage }).localStorage = storage;
  return storage;
}

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe("otpFlowMarker (the same-browser gate for the confirm route)", () => {
  beforeEach(() => {
    installStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("present -> the confirm route reads a valid marker and takes the verify path", () => {
    setOtpFlowMarker("ada@example.com", NOW);
    expect(hasOtpFlowMarker(NOW)).toBe(true);
    expect(readOtpFlowMarker(NOW)).toEqual({
      email: "ada@example.com",
      ts: NOW,
    });
  });

  it("absent -> no marker reads as absent, so the confirm route shows guidance + escape hatch", () => {
    expect(hasOtpFlowMarker(NOW)).toBe(false);
    expect(readOtpFlowMarker(NOW)).toBeNull();
  });

  it("a marker older than an hour reads as absent (a stale link is treated as cross-device)", () => {
    setOtpFlowMarker("ada@example.com", NOW);
    expect(hasOtpFlowMarker(NOW + HOUR - 1)).toBe(true);
    expect(hasOtpFlowMarker(NOW + HOUR + 1)).toBe(false);
    expect(readOtpFlowMarker(NOW + HOUR + 1)).toBeNull();
  });

  it("clearing the marker on sign-in makes a later link click read as absent", () => {
    setOtpFlowMarker("ada@example.com", NOW);
    clearOtpFlowMarker();
    expect(hasOtpFlowMarker(NOW)).toBe(false);
  });

  it("a malformed stored value reads as absent, never a throw", () => {
    const storage = installStorage();
    storage.setItem("crossy.otp.pending", "{not json");
    expect(readOtpFlowMarker(NOW)).toBeNull();
    storage.setItem("crossy.otp.pending", JSON.stringify({ email: 42 }));
    expect(readOtpFlowMarker(NOW)).toBeNull();
  });

  it("degrades to absent (never throws) when localStorage is missing", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(() => setOtpFlowMarker("ada@example.com", NOW)).not.toThrow();
    expect(hasOtpFlowMarker(NOW)).toBe(false);
    expect(() => clearOtpFlowMarker()).not.toThrow();
  });
});
