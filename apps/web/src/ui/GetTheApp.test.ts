import { describe, expect, it } from "vitest";
import { shouldShowAppPrompt } from "./GetTheApp";

// The app prompt's gate is pure: it shows only on iOS, only when the deploy configured a
// TestFlight link, and only until dismissed. Desktop never sees it, so the pointer-first
// layout is never touched.

const iPhoneUA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const desktopUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const base = {
  testflightUrl: "https://testflight.apple.com/join/aBcD1234",
  dismissed: false,
  userAgent: iPhoneUA,
  platform: "iPhone",
  maxTouchPoints: 5,
};

describe("shouldShowAppPrompt", () => {
  it("shows on iPhone when a TestFlight link is set and not dismissed", () => {
    expect(shouldShowAppPrompt(base)).toBe(true);
  });

  it("hides when the deploy configured no TestFlight link", () => {
    expect(shouldShowAppPrompt({ ...base, testflightUrl: undefined })).toBe(
      false,
    );
    expect(shouldShowAppPrompt({ ...base, testflightUrl: "" })).toBe(false);
  });

  it("hides once dismissed", () => {
    expect(shouldShowAppPrompt({ ...base, dismissed: true })).toBe(false);
  });

  it("hides on desktop, so it never competes with the pointer layout", () => {
    expect(
      shouldShowAppPrompt({
        ...base,
        userAgent: desktopUA,
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
  });

  it("treats an iPadOS device (desktop Mac UA plus touch) as iOS", () => {
    expect(
      shouldShowAppPrompt({
        ...base,
        userAgent: desktopUA,
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
  });
});
