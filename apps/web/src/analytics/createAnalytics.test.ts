import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/config";
import { createAnalytics, shouldUsePosthog } from "./createAnalytics";

const base: AppConfig = {
  supabaseUrl: "",
  supabasePublishableKey: "",
  apiBase: "",
  guestsEnabled: false,
};

describe("adapter selection", () => {
  it("uses PostHog only when a token is present", () => {
    expect(shouldUsePosthog(base)).toBe(false);
    expect(shouldUsePosthog({ ...base, posthogToken: "" })).toBe(false);
    expect(shouldUsePosthog({ ...base, posthogToken: "phc_x" })).toBe(true);
    // The host alone selects nothing: without a token there is nothing to send.
    expect(
      shouldUsePosthog({ ...base, posthogHost: "https://ph.example" }),
    ).toBe(false);
  });

  it("falls back to the no-op adapter on empty config, and its methods never throw", () => {
    const analytics = createAnalytics(base);
    expect(() => {
      analytics.capture("app_opened");
      analytics.capture("signed_in", { count: 1 });
      analytics.identify("user-1", { isAnonymous: true });
      analytics.reset();
    }).not.toThrow();
  });

  it("builds a working Analytics when a token is present", () => {
    const analytics = createAnalytics({ ...base, posthogToken: "phc_x" });
    expect(typeof analytics.capture).toBe("function");
    expect(typeof analytics.identify).toBe("function");
    expect(typeof analytics.reset).toBe("function");
  });
});
