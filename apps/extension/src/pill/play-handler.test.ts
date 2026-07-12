// The worker holds no user gesture and a content script cannot call
// permissions.request, so the play handler only ever checks the grant. The first
// test wires containsOrigins to a stubbed chrome whose request records calls,
// proving the pre-check branch answers without one (the settings.test.ts model).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "../envelope";
import { handlePlayRequest } from "./play-handler";
import type { PlayDeps } from "./play-handler";

const ENVELOPE: Envelope = { format: "guardian", document: { some: "doc" } };

function deps(overrides: Partial<PlayDeps> = {}): PlayDeps {
  return {
    apiBaseUrl: "https://rest.crossy.party",
    containsOrigins: () => Promise.resolve(true),
    freshAccessToken: () => Promise.resolve({ ok: true, accessToken: "at" }),
    postPuzzle: () => Promise.resolve({ ok: true, puzzleId: "p_1" }),
    openTab: () => Promise.resolve(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handlePlayRequest", () => {
  it("answers no_permission from the contains pre-check alone; permissions.request is never called", async () => {
    const requestCalls: unknown[] = [];
    vi.stubGlobal("chrome", {
      permissions: {
        contains: () => Promise.resolve(false),
        request: (arg: unknown) => {
          requestCalls.push(arg);
          return Promise.resolve(true);
        },
      },
    });
    const reply = await handlePlayRequest(
      ENVELOPE,
      deps({
        containsOrigins: (origins) =>
          chrome.permissions.contains({ origins: [...origins] }),
        freshAccessToken: () => {
          throw new Error("must not reach auth without the grant");
        },
      }),
    );
    expect(reply).toEqual({ ok: false, reason: "no_permission" });
    expect(requestCalls).toEqual([]);
  });

  it("checks the API base's origin pattern, ports folded like every grant", async () => {
    let seen: readonly string[] = [];
    await handlePlayRequest(
      ENVELOPE,
      deps({
        apiBaseUrl: "http://localhost:3000",
        containsOrigins: (origins) => {
          seen = origins;
          return Promise.resolve(true);
        },
      }),
    );
    expect(seen).toEqual(["http://localhost/*"]);
  });

  it("relays signed_out so the pill defers to the popup", async () => {
    const reply = await handlePlayRequest(
      ENVELOPE,
      deps({
        freshAccessToken: () =>
          Promise.resolve({ ok: false, reason: "signed_out" }),
      }),
    );
    expect(reply).toEqual({ ok: false, reason: "signed_out" });
  });

  it("maps a token refresh network failure to a retryable network reply", async () => {
    const reply = await handlePlayRequest(
      ENVELOPE,
      deps({
        freshAccessToken: () =>
          Promise.resolve({ ok: false, reason: "network" }),
      }),
    );
    expect(reply).toEqual({ ok: false, reason: "network" });
  });

  it("keeps a named rejection verbatim, code and message untouched (PROTOCOL.md section 12)", async () => {
    const reply = await handlePlayRequest(
      ENVELOPE,
      deps({
        postPuzzle: () =>
          Promise.resolve({
            ok: false,
            code: "GRID_MALFORMED",
            message: "row 3 is short",
          }),
      }),
    );
    expect(reply).toEqual({
      ok: false,
      reason: "rejected",
      code: "GRID_MALFORMED",
      message: "row 3 is short",
    });
  });

  it("answers a retryable network reply when the POST throws", async () => {
    const reply = await handlePlayRequest(
      ENVELOPE,
      deps({
        postPuzzle: () => Promise.reject(new TypeError("fetch failed")),
      }),
    );
    expect(reply).toEqual({ ok: false, reason: "network" });
  });

  it("opens the play intent for the ingested puzzle, envelope crossed verbatim (D21)", async () => {
    const opened: string[] = [];
    let posted: Envelope | null = null;
    const reply = await handlePlayRequest(
      ENVELOPE,
      deps({
        postPuzzle: (_base, _token, envelope) => {
          posted = envelope;
          return Promise.resolve({ ok: true, puzzleId: "p_9" });
        },
        openTab: (url) => {
          opened.push(url);
          return Promise.resolve();
        },
      }),
    );
    expect(reply).toEqual({ ok: true });
    expect(opened).toEqual(["https://crossy.party/puzzles?play=p_9"]);
    expect(posted).toBe(ENVELOPE);
  });
});
