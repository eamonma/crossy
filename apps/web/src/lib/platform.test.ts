import { describe, expect, it } from "vitest";

import { isAppleMobile } from "./platform";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_MOBILE =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// iPadOS 13+ in its default desktop mode: the agent says Macintosh, only the touch screen tells.
const IPAD_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

describe("isAppleMobile (only offer the crossy:// handoff where the iOS app can exist)", () => {
  it("is true for iPhone, iPad, and iPod agents", () => {
    expect(isAppleMobile(IPHONE, 5)).toBe(true);
    expect(isAppleMobile(IPAD_MOBILE, 5)).toBe(true);
  });

  it("treats a Macintosh agent with a touch screen as an iPad (iPadOS desktop mode)", () => {
    expect(isAppleMobile(IPAD_DESKTOP, 5)).toBe(true);
  });

  it("is false for a real Mac (trackpad, no touch points)", () => {
    expect(isAppleMobile(MAC, 0)).toBe(false);
  });

  it("is false for Android and other non-Apple platforms", () => {
    expect(isAppleMobile(ANDROID, 5)).toBe(false);
  });
});
