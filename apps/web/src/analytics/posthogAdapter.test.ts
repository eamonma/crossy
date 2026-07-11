// The PostHog adapter suite. posthog-js is never initialized for real and the network is
// never touched: a fake client is injected through deps.client, so these tests pin the
// adapter's contract (token and host pass-through, replay off, autocapture and pageviews
// on, best-effort calls) without a vendor or a socket.
import { describe, expect, it, vi } from "vitest";
import { createPosthogAnalytics } from "./posthogAdapter";
import type { PosthogAnalyticsDeps } from "./posthogAdapter";

type FakeClient = {
  init: ReturnType<typeof vi.fn>;
  capture: ReturnType<typeof vi.fn>;
  identify: ReturnType<typeof vi.fn>;
  reset: ReturnType<typeof vi.fn>;
};

function makeClient(over: Partial<FakeClient> = {}): FakeClient {
  return {
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    ...over,
  };
}

function asDep(
  client: FakeClient,
): NonNullable<PosthogAnalyticsDeps["client"]> {
  return client as unknown as NonNullable<PosthogAnalyticsDeps["client"]>;
}

describe("posthog analytics adapter", () => {
  it("passes the token and host through to init", () => {
    const client = makeClient();
    createPosthogAnalytics({
      token: "phc_test",
      host: "https://ph.example",
      client: asDep(client),
    });
    expect(client.init).toHaveBeenCalledTimes(1);
    const [token, config] = client.init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(token).toBe("phc_test");
    expect(config["api_host"]).toBe("https://ph.example");
    expect(config["defaults"]).toBe("2026-05-30");
  });

  it("omits api_host when the config has no host, so the vendor default applies", () => {
    const client = makeClient();
    createPosthogAnalytics({ token: "phc_test", client: asDep(client) });
    const [, config] = client.init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect("api_host" in config).toBe(false);
  });

  it("INV-6: session replay is disabled at init; the board DOM converges on the solution", () => {
    const client = makeClient();
    createPosthogAnalytics({ token: "phc_test", client: asDep(client) });
    const [, config] = client.init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(config["disable_session_recording"]).toBe(true);
  });

  it("keeps autocapture on and pageviews riding history changes (SPA routing)", () => {
    const client = makeClient();
    createPosthogAnalytics({ token: "phc_test", client: asDep(client) });
    const [, config] = client.init.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(config["autocapture"]).toBe(true);
    expect(config["capture_pageview"]).toBe("history_change");
  });

  it("forwards capture, identify, and reset to the vendor", () => {
    const client = makeClient();
    const analytics = createPosthogAnalytics({
      token: "phc_test",
      client: asDep(client),
    });
    analytics.capture("signed_in", { isAnonymous: false });
    analytics.identify("user-1", { isAnonymous: true });
    analytics.reset();
    expect(client.capture).toHaveBeenCalledWith("signed_in", {
      isAnonymous: false,
    });
    expect(client.identify).toHaveBeenCalledWith("user-1", {
      isAnonymous: true,
    });
    expect(client.reset).toHaveBeenCalledTimes(1);
  });

  it("capture and identify never throw when the vendor faults (analytics is best-effort)", () => {
    const boom = (): never => {
      throw new Error("vendor fault");
    };
    const client = makeClient({
      init: vi.fn(boom),
      capture: vi.fn(boom),
      identify: vi.fn(boom),
      reset: vi.fn(boom),
    });
    const analytics = createPosthogAnalytics({
      token: "phc_test",
      client: asDep(client),
    });
    expect(() => {
      analytics.capture("app_opened");
      analytics.identify("user-1");
      analytics.reset();
    }).not.toThrow();
  });
});
