// Analytics port tests: the noop selection (absent token, SDK never constructed), the
// forward of distinctId/event/properties through an injected fake client, the swallow-to-log
// error posture (capture must never throw into the actor path), and the flush-on-shutdown
// contract. No network anywhere; the fake stands in for posthog-node at the port boundary.
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POSTHOG_HOST,
  createNoopAnalytics,
  createPosthogAnalytics,
  readPosthogConfig,
} from "./analytics";
import type { AnalyticsClient, AnalyticsProperties } from "./analytics";

interface FakeClient extends AnalyticsClient {
  readonly captured: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }[];
  readonly shutdowns: number[];
}

function fakeClient(over: Partial<AnalyticsClient> = {}): FakeClient {
  const captured: FakeClient["captured"] = [];
  const shutdowns: number[] = [];
  return {
    captured,
    shutdowns,
    capture(msg) {
      captured.push(msg);
    },
    shutdown() {
      shutdowns.push(Date.now());
      return Promise.resolve();
    },
    ...over,
  };
}

describe("readPosthogConfig", () => {
  it("returns null when POSTHOG_TOKEN is absent, selecting the noop", () => {
    expect(readPosthogConfig({})).toBeNull();
  });

  it("treats an empty POSTHOG_TOKEN as absent (12-factor unset convention)", () => {
    expect(readPosthogConfig({ POSTHOG_TOKEN: "" })).toBeNull();
  });

  it("defaults POSTHOG_HOST to the US cloud host", () => {
    expect(readPosthogConfig({ POSTHOG_TOKEN: "phc_x" })).toEqual({
      token: "phc_x",
      host: DEFAULT_POSTHOG_HOST,
    });
  });

  it("honors an explicit POSTHOG_HOST", () => {
    expect(
      readPosthogConfig({
        POSTHOG_TOKEN: "phc_x",
        POSTHOG_HOST: "https://eu.i.posthog.com",
      }),
    ).toEqual({ token: "phc_x", host: "https://eu.i.posthog.com" });
  });
});

describe("noop analytics", () => {
  it("capture and shutdown do nothing and never construct the SDK", async () => {
    const analytics = createNoopAnalytics();
    expect(() =>
      analytics.capture({ distinctId: "u1", event: "room_joined" }),
    ).not.toThrow();
    await expect(analytics.shutdown()).resolves.toBeUndefined();
  });
});

describe("posthog analytics adapter", () => {
  it("constructs the client exactly once per process", () => {
    const factory = vi.fn(() => fakeClient());
    const analytics = createPosthogAnalytics(
      { token: "phc_x", host: DEFAULT_POSTHOG_HOST },
      factory,
    );
    analytics.capture({ distinctId: "u1", event: "room_joined" });
    analytics.capture({ distinctId: "u2", event: "room_joined" });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith({
      token: "phc_x",
      host: DEFAULT_POSTHOG_HOST,
    });
  });

  it("capture forwards distinctId, event, and properties to the client", () => {
    const client = fakeClient();
    const analytics = createPosthogAnalytics(
      { token: "phc_x", host: DEFAULT_POSTHOG_HOST },
      () => client,
    );
    analytics.capture({
      distinctId: "user-1",
      event: "solve_completed",
      properties: { roomId: "game-1", filled: 78, total: 78 },
    });
    expect(client.captured).toEqual([
      {
        distinctId: "user-1",
        event: "solve_completed",
        properties: { roomId: "game-1", filled: 78, total: 78 },
      },
    ]);
  });

  it("capture carries exactly the given ids and counts, nothing ambient (INV-6)", () => {
    const client = fakeClient();
    const analytics = createPosthogAnalytics(
      { token: "phc_x", host: DEFAULT_POSTHOG_HOST },
      () => client,
    );
    analytics.capture({ distinctId: "room-1", event: "room_abandoned" });
    // No properties given: none forwarded, and no field is invented on the way through.
    expect(client.captured).toEqual([
      { distinctId: "room-1", event: "room_abandoned" },
    ]);
  });

  it("property values are flat primitives, so a board or cell list cannot ride an event (INV-6)", () => {
    // Compile-time guarantee: the property value union excludes arrays and objects.
    // @ts-expect-error an array (a cell list) is not a legal property value
    const cells: AnalyticsProperties = { cells: ["A", "B"] };
    // @ts-expect-error an object (a board) is not a legal property value
    const board: AnalyticsProperties = { board: { 0: "A" } };
    const legal: AnalyticsProperties = { roomId: "g1", filled: 3, total: 78 };
    expect({ cells, board, legal }).toBeDefined();
  });

  it("capture never throws into the caller's path; a client fault is one log line", () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const analytics = createPosthogAnalytics(
      { token: "phc_x", host: DEFAULT_POSTHOG_HOST },
      () =>
        fakeClient({
          capture: () => {
            throw new Error("queue closed");
          },
        }),
    );
    expect(() =>
      analytics.capture({ distinctId: "u1", event: "room_joined" }),
    ).not.toThrow();
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  it("shutdown awaits the client's flush-and-close", async () => {
    const client = fakeClient();
    const analytics = createPosthogAnalytics(
      { token: "phc_x", host: DEFAULT_POSTHOG_HOST },
      () => client,
    );
    await analytics.shutdown();
    expect(client.shutdowns).toHaveLength(1);
  });

  it("shutdown swallows a flush fault to a log line", async () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const analytics = createPosthogAnalytics(
      { token: "phc_x", host: DEFAULT_POSTHOG_HOST },
      () =>
        fakeClient({
          shutdown: () => Promise.reject(new Error("flush failed")),
        }),
    );
    await expect(analytics.shutdown()).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });
});
