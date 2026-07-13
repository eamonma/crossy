// authedFetch is the REST retry seam (net/authedFetch.ts): one reactive refresh-and-retry
// on a server 401, at most once, mirroring iOS CrossyAPIClient.perform. These pin that
// contract so the fetchers above it stay dumb.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bearer } from "./authedFetch";
import { authedFetch } from "./authedFetch";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A bearer whose getToken/refresh return the queued values in order (null when drained). */
function bearer(
  tokens: (string | null)[],
  refreshes: (string | null)[],
): {
  b: Bearer;
  refreshCalls: () => number;
} {
  let refreshCalls = 0;
  return {
    b: {
      getToken: () => Promise.resolve(tokens.shift() ?? null),
      refresh: () => {
        refreshCalls += 1;
        return Promise.resolve(refreshes.shift() ?? null);
      },
    },
    refreshCalls: () => refreshCalls,
  };
}

/** Stub fetch to answer the queued statuses, recording the Authorization header per call. */
function stubFetch(statuses: number[]): { sent: (string | undefined)[] } {
  const sent: (string | undefined)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      sent.push((init?.headers as Record<string, string>)?.authorization);
      const status = statuses.shift() ?? 200;
      return Promise.resolve(new Response("{}", { status }));
    }),
  );
  return { sent };
}

describe("authedFetch (reactive refresh-and-retry on 401)", () => {
  it("a 2xx passes straight through: one request, no refresh", async () => {
    const { b, refreshCalls } = bearer(["tok"], []);
    const { sent } = stubFetch([200]);
    const res = await authedFetch(b, "https://api/games");
    expect(res.status).toBe(200);
    expect(sent).toEqual(["Bearer tok"]);
    expect(refreshCalls()).toBe(0);
  });

  it("a 401 forces one refresh and replays with the fresh token", async () => {
    const { b, refreshCalls } = bearer(["stale"], ["fresh"]);
    const { sent } = stubFetch([401, 200]);
    const res = await authedFetch(b, "https://api/games");
    expect(res.status).toBe(200);
    expect(sent).toEqual(["Bearer stale", "Bearer fresh"]);
    expect(refreshCalls()).toBe(1);
  });

  it("retries at most once: a second 401 is returned, not retried again", async () => {
    const { b, refreshCalls } = bearer(["stale"], ["also-stale"]);
    const { sent } = stubFetch([401, 401]);
    const res = await authedFetch(b, "https://api/games");
    expect(res.status).toBe(401);
    expect(sent).toEqual(["Bearer stale", "Bearer also-stale"]);
    expect(refreshCalls()).toBe(1);
  });

  it("surfaces the original 401 when the refresh cannot mint a token (no replay)", async () => {
    const { b, refreshCalls } = bearer(["stale"], [null]);
    const { sent } = stubFetch([401]);
    const res = await authedFetch(b, "https://api/games");
    expect(res.status).toBe(401);
    expect(sent).toEqual(["Bearer stale"]);
    expect(refreshCalls()).toBe(1);
  });

  it("does not retry a non-401 error (a 404/403 is not auth staleness)", async () => {
    const { b, refreshCalls } = bearer(["tok"], ["fresh"]);
    const { sent } = stubFetch([404]);
    const res = await authedFetch(b, "https://api/games");
    expect(res.status).toBe(404);
    expect(sent).toEqual(["Bearer tok"]);
    expect(refreshCalls()).toBe(0);
  });

  it("throws before any fetch when signed out (null token)", async () => {
    const { b } = bearer([null], []);
    const dialed = vi.fn();
    vi.stubGlobal("fetch", dialed);
    await expect(authedFetch(b, "https://api/games")).rejects.toThrow();
    expect(dialed).not.toHaveBeenCalled();
  });

  it("carries method, body, and headers into both the first try and the replay", async () => {
    const { b } = bearer(["stale"], ["fresh"]);
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        calls.push(init ?? {});
        return Promise.resolve(
          new Response("{}", { status: calls.length === 1 ? 401 : 200 }),
        );
      }),
    );
    await authedFetch(b, "https://api/games", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ puzzleId: "p1" }),
    });
    for (const init of calls) {
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["content-type"]).toBe(
        "application/json",
      );
      expect(init.body).toBe(JSON.stringify({ puzzleId: "p1" }));
    }
    expect((calls[1]!.headers as Record<string, string>).authorization).toBe(
      "Bearer fresh",
    );
  });
});
