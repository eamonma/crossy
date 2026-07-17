// The live completion mosaic mount's pure core (completedMosaic.ts). These defend the wiring the
// screenshots cannot: the owner-map source (last-writer instant, first-correct on resolve), the
// completion-race retry (fall back to last-writer while the fetch is pending or 404s), and the
// edge-trigger rule (bloom on the ongoing -> completed transition, not on a revisit). INV-6
// corollary: the attribution payload carries userIds only, so nothing here can surface a solution;
// the map is ids, resolved to color through the roster elsewhere.
import { describe, expect, it } from "vitest";
import type { Board } from "@crossy/protocol";
import { GameStore } from "../store/gameStore";
import type { StackMember } from "./primitives";
import type { OwnerMap } from "./mosaicReveal";
import type { Bearer } from "../net/authedFetch";
import {
  fetchAnalysisOnce,
  fetchAttributionOnce,
  fetchAttributionWithRetry,
  lastWriterOwnerMap,
  readSittings,
  rosterOf,
  shouldBloomOnCompletion,
} from "./completionAttribution";
import { identityColor } from "./identityRoster";

/** A completed board with the given cells (v, by), the rest empty. */
function completedBoard(
  cells: ReadonlyArray<{ v: string | null; by: string | null }>,
): Board {
  return {
    seq: 5,
    status: "completed",
    firstFillAt: "2026-07-07T00:00:00Z",
    completedAt: "2026-07-07T00:06:12Z",
    abandonedAt: null,
    cells: [...cells],
    checkedWrongCells: [],
    checkCount: 0,
    participants: [],
    cursors: [],
    recentCommandIds: [],
    stats: {
      solveTimeSeconds: 372,
      totalEvents: 4,
      participantCount: 2,
      checkCount: 0,
    },
  };
}

function storeFrom(board: Board): GameStore {
  const store = new GameStore({ transport: { send: () => {} } });
  store.receive({
    type: "welcome",
    protocolVersion: 1,
    self: { userId: "me", role: "solver" },
    board,
  });
  return store;
}

describe("lastWriterOwnerMap (instant paint from store.writerOf)", () => {
  it("maps each written cell to its last writer, and omits empty/never-written cells", () => {
    // Cells 0 and 2 are written by two players; cell 1 was written then cleared (v null but a
    // writer stands); cell 3 is untouched (v and by both null).
    const store = storeFrom(
      completedBoard([
        { v: "A", by: "u-mara" },
        { v: null, by: "u-ivo" },
        { v: "C", by: "u-mara" },
        { v: null, by: null },
      ]),
    );
    const map = lastWriterOwnerMap(store, 4);
    // Whoever last wrote a cell owns it, the same `by` the conflict flash reads (no new data path).
    expect(map[0]).toBe("u-mara");
    expect(map[2]).toBe("u-mara");
    // A cell with a writer but a null value still has an owner (an erase is a write).
    expect(map[1]).toBe("u-ivo");
    // A never-written cell has no owner, so it stays uncolored.
    expect(map[3]).toBeUndefined();
    expect(Object.keys(map)).toHaveLength(3);
  });

  it("needs no network: it reads only the store's confirmed writers (INV-6, no solution path)", () => {
    const store = storeFrom(completedBoard([{ v: "Z", by: "u-solo" }]));
    // Synchronous, from store state alone; the owner map is userIds, never a letter or a solution.
    const map = lastWriterOwnerMap(store, 1);
    expect(map).toEqual({ 0: "u-solo" });
  });
});

describe("rosterOf (mosaic and overlay agree on each player's color)", () => {
  it("keys the roster by userId to the same color the overlay's members carry", () => {
    const members: StackMember[] = [
      member("u-mara", "#3e63dd"),
      member("u-ivo", "#e5484d"),
    ];
    const roster = rosterOf(members, false);
    // The mosaic resolves an owner id through the shared identity palette (DESIGN.md §8) to the same
    // ground-matched hex the legend and iOS paint, so the surfaces cannot paint one player two colors.
    expect(roster["u-mara"]?.color).toBe(identityColor("#3e63dd", false));
    expect(roster["u-ivo"]?.color).toBe(identityColor("#e5484d", false));
  });
});

describe("shouldBloomOnCompletion (edge-trigger, ongoing -> completed only)", () => {
  it("blooms when the surface was ongoing at mount and then reached completed (the live edge)", () => {
    expect(shouldBloomOnCompletion(false)).toBe(true);
  });

  it("does NOT re-bloom on a revisit/reload that mounts already completed (settled wash)", () => {
    expect(shouldBloomOnCompletion(true)).toBe(false);
  });
});

describe("fetchAttributionOnce (GET /games/:id/analysis, reads owners; INV-6 userIds only)", () => {
  const bearer: Bearer = {
    getToken: () => Promise.resolve("tok"),
    refresh: () => Promise.resolve(null),
  };

  it("parses the wire owners (string cell keys) back into a numeric-keyed owner map", async () => {
    const fetchStub = stubFetch({
      ok: true,
      json: { owners: { "0": "u-a", "5": "u-b", "12": "u-a" } },
    });
    await withFetch(fetchStub, async () => {
      const map = await fetchAttributionOnce("https://api", "g1", bearer);
      expect(map).toEqual({ 0: "u-a", 5: "u-b", 12: "u-a" });
    });
    // The call hit the analysis endpoint with the bearer resolved fresh.
    expect(fetchStub.calls[0]?.url).toBe("https://api/games/g1/analysis");
    expect(fetchStub.calls[0]?.auth).toBe("Bearer tok");
  });

  it("returns null on a 404 (the completion race) without throwing, so the caller keeps last-writer", async () => {
    await withFetch(stubFetch({ ok: false, status: 404 }), async () => {
      expect(
        await fetchAttributionOnce("https://api", "g1", bearer),
      ).toBeNull();
    });
  });

  it("returns null on a network error, never surfacing it to the player", async () => {
    const throwing: FetchLike = () => Promise.reject(new Error("offline"));
    await withFetch(throwing, async () => {
      expect(
        await fetchAttributionOnce("https://api", "g1", bearer),
      ).toBeNull();
    });
  });

  it("returns null when signed out (no bearer), never calling the endpoint (INV-11: the seam throws before any dial)", async () => {
    const fetchStub = stubFetch({ ok: true, json: { owners: {} } });
    await withFetch(fetchStub, async () => {
      const map = await fetchAttributionOnce("https://api", "g1", {
        getToken: () => Promise.resolve(null),
        refresh: () => Promise.resolve(null),
      });
      expect(map).toBeNull();
    });
    expect(fetchStub.calls).toHaveLength(0);
  });

  it("a stale bearer rides the seam: one 401 forces a refresh and the replay wins (INV-11)", async () => {
    const calls: FetchCall[] = [];
    const sequenced: FetchLike = (input, init) => {
      calls.push({ url: input, auth: init?.headers?.["authorization"] });
      return Promise.resolve(
        (calls.length === 1
          ? { ok: false, status: 401, json: () => Promise.resolve({}) }
          : {
              ok: true,
              status: 200,
              json: () => Promise.resolve({ owners: { "0": "u-a" } }),
            }) as Response,
      );
    };
    await withFetch(sequenced, async () => {
      const map = await fetchAttributionOnce("https://api", "g1", {
        getToken: () => Promise.resolve("stale"),
        refresh: () => Promise.resolve("fresh"),
      });
      // The 401 never surfaces: the seam refreshed and replayed, and the owner map landed.
      expect(map).toEqual({ 0: "u-a" });
    });
    expect(calls.map((c) => c.auth)).toEqual(["Bearer stale", "Bearer fresh"]);
  });
});

describe("fetchAnalysisOnce (the whole bundle; titles tolerate an older API)", () => {
  const bearer: Bearer = {
    getToken: () => Promise.resolve("tok"),
    refresh: () => Promise.resolve(null),
  };

  it("passes the wire's titles through untouched (order, keys, evidence; PROTOCOL §12)", async () => {
    const titles = [
      { userId: "u-a", title: "saboteur", evidence: 7 },
      { userId: "u-b", title: "one-hit-wonder", evidence: null },
    ];
    await withFetch(
      stubFetch({ ok: true, json: { owners: {}, titles } }),
      async () => {
        const bundle = await fetchAnalysisOnce("https://api", "g1", bearer);
        expect(bundle?.titles).toEqual(titles);
      },
    );
  });

  it("reads an absent titles field (an API that predates the ladder) as empty, never a crash", async () => {
    await withFetch(
      stubFetch({ ok: true, json: { owners: { "0": "u-a" } } }),
      async () => {
        const bundle = await fetchAnalysisOnce("https://api", "g1", bearer);
        expect(bundle?.titles).toEqual([]);
        expect(bundle?.owners).toEqual({ 0: "u-a" });
      },
    );
  });

  it("reads a malformed titles field as empty (the additive field never poisons the bundle)", async () => {
    await withFetch(
      stubFetch({ ok: true, json: { owners: {}, titles: "nope" } }),
      async () => {
        const bundle = await fetchAnalysisOnce("https://api", "g1", bearer);
        expect(bundle?.titles).toEqual([]);
      },
    );
  });

  it("passes the wire's sittings through untouched (count, spans, wallSeconds; PROTOCOL §12, D29)", async () => {
    const sittings = {
      count: 2,
      spans: [
        { startSeconds: 0, endSeconds: 300 },
        { startSeconds: 300, endSeconds: 360 },
      ],
      wallSeconds: 29160,
    };
    await withFetch(
      stubFetch({ ok: true, json: { owners: {}, sittings } }),
      async () => {
        const bundle = await fetchAnalysisOnce("https://api", "g1", bearer);
        expect(bundle?.sittings).toEqual(sittings);
      },
    );
  });

  it("omits sittings when the field is absent (an older cached bundle degrades, PROTOCOL §12, D29)", async () => {
    await withFetch(stubFetch({ ok: true, json: { owners: {} } }), async () => {
      const bundle = await fetchAnalysisOnce("https://api", "g1", bearer);
      expect(bundle?.sittings).toBeUndefined();
    });
  });
});

describe("readSittings (the additive field never poisons the bundle, D29)", () => {
  it("reads a sound shape, spans in order", () => {
    expect(
      readSittings({
        count: 2,
        spans: [
          { startSeconds: 0, endSeconds: 300 },
          { startSeconds: 300, endSeconds: 360 },
        ],
        wallSeconds: 29160,
      }),
    ).toEqual({
      count: 2,
      spans: [
        { startSeconds: 0, endSeconds: 300 },
        { startSeconds: 300, endSeconds: 360 },
      ],
      wallSeconds: 29160,
    });
  });

  it("reads any malformed shape as absence, so the surface degrades instead of crashing", () => {
    expect(readSittings(undefined)).toBeUndefined();
    expect(readSittings("nope")).toBeUndefined();
    expect(readSittings({ count: 2 })).toBeUndefined();
    expect(
      readSittings({ count: "2", spans: [], wallSeconds: 1 }),
    ).toBeUndefined();
    expect(
      readSittings({ count: 2, spans: "nope", wallSeconds: 1 }),
    ).toBeUndefined();
    expect(
      readSittings({
        count: 2,
        spans: [{ startSeconds: 0 }],
        wallSeconds: 1,
      }),
    ).toBeUndefined();
    expect(
      readSittings({
        count: 2,
        spans: [{ startSeconds: 0, endSeconds: Number.NaN }],
        wallSeconds: 1,
      }),
    ).toBeUndefined();
  });
});

describe("fetchAttributionWithRetry (completion-race backoff, swap on resolve)", () => {
  const noWait = () => Promise.resolve();

  it("keeps trying while the endpoint 404s, then swaps to first-correct when it resolves", async () => {
    // The race: two 404s (session has not flushed completed_at yet), then the true owner map.
    const results: Array<OwnerMap | null> = [null, null, { 0: "u-a" }];
    let call = 0;
    const owners = await fetchAttributionWithRetry(
      () => Promise.resolve(results[call++] ?? null),
      { tries: 3, sleep: noWait },
    );
    expect(owners).toEqual({ 0: "u-a" });
    expect(call).toBe(3); // it retried across the race, it did not give up on the first 404
  });

  it("gives up silently after the retry budget, so the caller keeps the last-writer paint", async () => {
    let call = 0;
    const owners = await fetchAttributionWithRetry(
      () => {
        call++;
        return Promise.resolve<OwnerMap | null>(null); // 404 forever
      },
      { tries: 3, sleep: noWait },
    );
    // Null means "no swap": the pending/failed fetch leaves the instant last-writer map in place.
    expect(owners).toBeNull();
    expect(call).toBe(3); // exactly the budget, no unbounded loop
  });

  it("takes the first success immediately, without exhausting the budget", async () => {
    let call = 0;
    const owners = await fetchAttributionWithRetry(
      () => {
        call++;
        return Promise.resolve<OwnerMap | null>({ 3: "u-z" });
      },
      { tries: 3, sleep: noWait },
    );
    expect(owners).toEqual({ 3: "u-z" });
    expect(call).toBe(1);
  });

  it("stops when aborted (the surface unmounted), so it never swaps into a dead component", async () => {
    const signal = { aborted: true };
    let call = 0;
    const owners = await fetchAttributionWithRetry(
      () => {
        call++;
        return Promise.resolve<OwnerMap | null>({ 0: "u-a" });
      },
      { tries: 3, sleep: noWait, signal },
    );
    expect(owners).toBeNull();
    expect(call).toBe(0); // aborted before any fetch
  });
});

// --- helpers ------------------------------------------------------------------------------------

function member(userId: string, color: string): StackMember {
  return {
    userId,
    name: userId,
    initial: userId.charAt(0),
    avatarUrl: null,
    color,
    connected: true,
    role: "solver",
  };
}

interface FetchCall {
  url: string;
  auth: string | undefined;
}

/** A fetch stand-in: the fetch signature the code under test uses, plus a recorded call log. */
type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<Response>;
type StubFetch = FetchLike & { calls: FetchCall[] };

/** A minimal fetch stub returning one canned response, recording each call's url and bearer. */
function stubFetch(response: {
  ok: boolean;
  status?: number;
  json?: unknown;
}): StubFetch {
  const calls: FetchCall[] = [];
  const fn: StubFetch = Object.assign(
    (input: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url: input, auth: init?.headers?.["authorization"] });
      return Promise.resolve({
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 500),
        json: () => Promise.resolve(response.json),
      } as Response);
    },
    { calls },
  );
  return fn;
}

/** Run `body` with `globalThis.fetch` swapped for `stub`, restoring it after (even on throw). */
async function withFetch(
  stub: FetchLike,
  body: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = original;
  }
}
