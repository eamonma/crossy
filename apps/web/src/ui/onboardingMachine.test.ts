// The onboarding machine transitions, walked as a pure table (no React, node env). Mirrors the
// otpModalMachine test: the states and the reason copy are the contract the dialog leans on, so a
// change to either is caught here rather than in a render.
import { describe, expect, it } from "vitest";
import type { SetDisplayNameReason } from "../identity";
import {
  DISPLAY_NAME_REASON_COPY,
  ONBOARDING_COPY,
  clearError,
  displayNameErrorOf,
  initialOnboardingState,
  saveFailed,
  toSaving,
} from "./onboardingMachine";

describe("onboarding machine", () => {
  it("starts on the entry step with no error", () => {
    expect(initialOnboardingState).toEqual({ step: "entry", error: null });
  });

  it("entry -> saving on submit", () => {
    expect(toSaving()).toEqual({ step: "saving" });
  });

  it("saving -> entry with the reason on a bounded-out failure (never a dead end, R4)", () => {
    expect(saveFailed("NAME_INVALID")).toEqual({
      step: "entry",
      error: "NAME_INVALID",
    });
  });

  it("saving -> entry cleared on a fresh attempt", () => {
    expect(clearError()).toEqual({ step: "entry", error: null });
  });

  it("carries a rate-limit reason back to entry so the copy shows (R9)", () => {
    const next = saveFailed("rate_limited");
    expect(next).toEqual({ step: "entry", error: "rate_limited" });
  });

  it("has calm, one-sentence copy for every reason (no em dash, American English)", () => {
    const reasons: SetDisplayNameReason[] = [
      "NAME_REQUIRED",
      "NAME_TOO_LONG",
      "NAME_INVALID",
      "rate_limited",
      "network",
      "unknown",
    ];
    for (const reason of reasons) {
      const copy = displayNameErrorOf(reason);
      expect(copy.length).toBeGreaterThan(0);
      expect(copy).not.toContain("—");
      // One sentence: exactly one terminal period run, no error code leaking through.
      expect(copy).not.toContain(reason);
    }
    // The map and the accessor agree.
    expect(displayNameErrorOf("rate_limited")).toBe(
      DISPLAY_NAME_REASON_COPY.rate_limited,
    );
  });

  it("exposes the static onboarding copy (section 14.2)", () => {
    expect(ONBOARDING_COPY.title).toBe("What should we call you?");
    expect(ONBOARDING_COPY.submit).toBe("Continue");
    expect(ONBOARDING_COPY.description).not.toContain("—");
  });
});
