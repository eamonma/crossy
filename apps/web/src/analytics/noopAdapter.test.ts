import { describe, expect, it } from "vitest";
import { createNoopAnalytics } from "./noopAdapter";

describe("noop analytics adapter", () => {
  it("runs the full port without a vendor: capture, identify, and reset never throw", () => {
    const analytics = createNoopAnalytics();
    expect(() => {
      analytics.capture("app_opened");
      analytics.capture("signed_in", { isAnonymous: true });
      analytics.identify("user-1", { isAnonymous: false });
      analytics.identify("user-1");
      analytics.reset();
    }).not.toThrow();
  });

  it("returns void from every method: nothing is recorded, nothing to await", () => {
    const analytics = createNoopAnalytics();
    expect(analytics.capture("app_opened")).toBeUndefined();
    expect(analytics.identify("user-1")).toBeUndefined();
    expect(analytics.reset()).toBeUndefined();
  });
});
