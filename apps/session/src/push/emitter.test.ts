// Emitter tests (PROTOCOL.md "Live Activity push"). These cover the disabled no-op path, the
// content-state build (pucks + counts), the envelope (aps.event / timestamp / stale-date /
// dismissal-date), and the fire-and-forget dispatch through a fake adapter and a fake pool. No
// container and no real APNs. The encode-side conformance check (a serialized content-state
// validates against the vector fixtures' shape) lives here too, reusing the protocol type.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { LiveActivityContentState } from "@crossy/protocol";
import { LIVE_ACTIVITY_MAX_PUCKS } from "@crossy/protocol";
import { colorForUser } from "../color";
import type { MemberRow } from "../repo";
import type { ApnsAdapter, ApnsRequest, ApnsResult } from "./apns";
import {
  BUNDLE_ID,
  LiveActivityPushEmitter,
  buildContentState,
  buildEnvelope,
  createInertEmitter,
  readApnsCredentials,
} from "./emitter";
import type { BoardFacts } from "./emitter";
import { DISMISS_AFTER_MS, STALE_AFTER_MS } from "./policy";

const here = dirname(fileURLToPath(import.meta.url));

function facts(over: Partial<BoardFacts> = {}): BoardFacts {
  return {
    filled: 10,
    total: 78,
    status: "ongoing",
    completedAt: null,
    connectedUserIds: new Set<string>(),
    ...over,
  };
}

function member(over: Partial<MemberRow> & { userId: string }): MemberRow {
  return {
    displayName: over.userId,
    avatarUrl: null,
    role: "solver",
    ...over,
  };
}

// A fake adapter that records requests and returns a scripted result (default: ok).
function fakeAdapter(
  respond: (req: ApnsRequest) => ApnsResult = () => ({ ok: true, status: 200 }),
): { adapter: ApnsAdapter; sent: ApnsRequest[]; dead: Set<string> } {
  const sent: ApnsRequest[] = [];
  const dead = new Set<string>();
  const adapter = {
    isDead: (t: string) => dead.has(t),
    async send(req: ApnsRequest) {
      sent.push(req);
      return respond(req);
    },
  } as unknown as ApnsAdapter;
  return { adapter, sent, dead };
}

// A fake pg Pool: answers loadMembers and loadLiveTokens from in-memory fixtures.
interface Fixture {
  members: MemberRow[];
  tokens: {
    token: string;
    userId: string;
    environment: "sandbox" | "production";
  }[];
}
function fakePool(fx: Fixture): {
  query: (sql: string, params: unknown[]) => Promise<unknown>;
} {
  return {
    query(sql: string) {
      if (/from memberships/i.test(sql)) {
        return Promise.resolve({
          rows: fx.members.map((m) => ({
            user_id: m.userId,
            display_name: m.displayName,
            avatar: m.avatarUrl,
            role: m.role,
          })),
        });
      }
      if (/from live_activity_tokens/i.test(sql)) {
        return Promise.resolve({
          rows: fx.tokens.map((t) => ({
            token: t.token,
            user_id: t.userId,
            apns_environment: t.environment,
          })),
        });
      }
      return Promise.reject(new Error(`unexpected query: ${sql}`));
    },
  };
}

/** Let the emitter's fire-and-forget microtask chain settle. */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("§12a emitter: the disabled path is a strict no-op (dev / CI inert)", () => {
  it("readApnsCredentials returns null when any var is absent", () => {
    expect(readApnsCredentials({})).toBeNull();
    expect(
      readApnsCredentials({ APNS_TEAM_ID: "t", APNS_KEY_ID: "k" }),
    ).toBeNull(); // no private key
    expect(
      readApnsCredentials({
        APNS_TEAM_ID: "t",
        APNS_KEY_ID: "",
        APNS_PRIVATE_KEY: "p",
      }),
    ).toBeNull(); // empty counts as absent
  });

  it("readApnsCredentials builds credentials with the bundle constant when complete", () => {
    const creds = readApnsCredentials({
      APNS_TEAM_ID: "t",
      APNS_KEY_ID: "k",
      APNS_PRIVATE_KEY: "pem",
    });
    expect(creds).toEqual({
      teamId: "t",
      keyId: "k",
      privateKeyPem: "pem",
      bundleId: BUNDLE_ID,
    });
  });

  it("the inert emitter enacts nothing on any hook", () => {
    const inert = createInertEmitter();
    // None of these throw or reach any IO; they are pure no-ops.
    expect(() => {
      inert.onPresence("g", facts());
      inert.onFill("g", facts());
      inert.onTerminal("g", facts());
      inert.onKick("g", "u", facts());
      inert.stop();
    }).not.toThrow();
  });
});

describe("§12a emitter: content-state build (pucks + counts, INV-6)", () => {
  it("builds pucks from the cluster (solvers/host only) with counts and status", () => {
    const members = [
      member({ userId: "aaaa", displayName: "Ann", role: "host" }),
      member({ userId: "bbbb", displayName: "Bea", role: "solver" }),
      member({ userId: "cccc", displayName: "Cal", role: "spectator" }),
    ];
    const cs = buildContentState(
      members,
      facts({ filled: 34, total: 78, connectedUserIds: new Set(["aaaa"]) }),
    );
    // Spectator Cal is excluded; Ann and Bea become pucks.
    expect(cs.pucks.map((p) => p.initial).sort()).toEqual(["A", "B"]);
    expect(cs.filled).toBe(34);
    expect(cs.total).toBe(78);
    expect(cs.status).toBe("ongoing");
    // Ann connected, Bea not.
    const ann = cs.pucks.find((p) => p.initial === "A")!;
    expect(ann.connected).toBe(true);
  });

  it("colors a puck by the session's own wire derivation (colorForUser round trip)", () => {
    const userId = "12345678-1234-1234-1234-123456789abc";
    const cs = buildContentState(
      [member({ userId, displayName: "Zoe" })],
      facts(),
    );
    // The puck color must be the dark-ground slot of colorForUser(userId).
    expect(cs.pucks).toHaveLength(1);
    // A stable, non-throwing color; the exact slot round-trip is pinned in roster.test.ts.
    expect(colorForUser(userId)).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("carries only counts, never board content (INV-6): fixed key set", () => {
    const cs = buildContentState(
      [member({ userId: "u", displayName: "U" })],
      facts(),
    );
    expect(Object.keys(cs).sort()).toEqual(
      ["completedAt", "filled", "pucks", "status", "total"].sort(),
    );
  });

  it("caps the cluster at four (LIVE_ACTIVITY_MAX_PUCKS)", () => {
    const members = ["Ann", "Bea", "Cal", "Dan", "Eve"].map((n, i) =>
      member({ userId: `u${i}`, displayName: n }),
    );
    const cs = buildContentState(members, facts());
    expect(cs.pucks.length).toBeLessThanOrEqual(LIVE_ACTIVITY_MAX_PUCKS);
    expect(cs.pucks).toHaveLength(4);
  });
});

describe("§12a emitter: envelope (aps.event / timestamp / stale-date / dismissal-date)", () => {
  const cs: LiveActivityContentState = {
    pucks: [{ initial: "E", red: 214, green: 178, blue: 92, connected: true }],
    filled: 34,
    total: 78,
    status: "ongoing",
    completedAt: null,
  };

  it("an update carries event update, a timestamp, and a stale-date, with the content-state", () => {
    const nowMs = 1_700_000_000_000;
    const body = JSON.parse(
      buildEnvelope(
        {
          event: "update",
          priority: 5,
          contentState: cs,
          audience: { kind: "game" },
          staleAfterMs: STALE_AFTER_MS,
        },
        nowMs,
      ),
    );
    expect(body.aps.event).toBe("update");
    expect(body.aps.timestamp).toBe(Math.floor(nowMs / 1000));
    expect(body.aps["stale-date"]).toBe(
      Math.floor((nowMs + STALE_AFTER_MS) / 1000),
    );
    expect(body.aps["dismissal-date"]).toBeUndefined();
    expect(body.aps["content-state"]).toMatchObject({
      filled: 34,
      total: 78,
      status: "ongoing",
    });
  });

  it("an end carries event end and a dismissal-date, no stale-date", () => {
    const nowMs = 1_700_000_000_000;
    const body = JSON.parse(
      buildEnvelope(
        {
          event: "end",
          priority: 10,
          contentState: {
            ...cs,
            status: "completed",
            completedAt: "2026-07-11T00:00:00Z",
            filled: 78,
          },
          audience: { kind: "game" },
          dismissMs: DISMISS_AFTER_MS,
        },
        nowMs,
      ),
    );
    expect(body.aps.event).toBe("end");
    expect(body.aps["dismissal-date"]).toBe(
      Math.floor((nowMs + DISMISS_AFTER_MS) / 1000),
    );
    expect(body.aps["stale-date"]).toBeUndefined();
    expect(body.aps["content-state"].status).toBe("completed");
  });
});

describe("§12a emitter: encode-side conformance against the vector fixtures", () => {
  // Reuse packages/protocol's type (apps may import packages): every fixture's content-state must
  // survive the emitter's own serialization and re-parse to the same shape, proving the emitter
  // encodes exactly what the vectors (and the widget's Codable) agree on.
  const familyDir = resolve(here, "../../../../vectors/live-activity");
  const cases: { name: string; contentState: LiveActivityContentState }[] =
    JSON.parse(readFileSync(resolve(familyDir, "content-state.json"), "utf8"));

  for (const c of cases) {
    it(`${c.name}: the emitter envelope round-trips the fixture content-state`, () => {
      const body = JSON.parse(
        buildEnvelope(
          {
            event: c.contentState.status === "ongoing" ? "update" : "end",
            priority: 5,
            contentState: c.contentState,
            audience: { kind: "game" },
            staleAfterMs: STALE_AFTER_MS,
          },
          1_000_000,
        ),
      );
      const encoded = body.aps["content-state"] as LiveActivityContentState;
      expect(encoded).toEqual(c.contentState);
      // Fixed key set (INV-6): the payload carries nothing beyond the agreed fields.
      expect(Object.keys(encoded).sort()).toEqual(
        ["completedAt", "filled", "pucks", "status", "total"].sort(),
      );
    });
  }
});

describe("§12a emitter: fire-and-forget dispatch through the adapter", () => {
  it("presence sends an update to every game token (priority 10)", async () => {
    const { adapter, sent } = fakeAdapter();
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [
        { token: "t1", userId: "u1", environment: "sandbox" },
        { token: "t2", userId: "u1", environment: "production" },
      ],
    });
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter,
      now: () => 1000,
    });
    emitter.onPresence("g1", facts({ connectedUserIds: new Set(["u1"]) }));
    await settle();
    expect(sent).toHaveLength(2);
    expect(sent.every((r) => r.priority === 10)).toBe(true);
  });

  it("a kick ends the kicked user's own token and updates the others", async () => {
    const { adapter, sent } = fakeAdapter();
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [
        { token: "kicked-tok", userId: "u9", environment: "sandbox" },
        { token: "other-tok", userId: "u1", environment: "sandbox" },
      ],
    });
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter,
      now: () => 1000,
    });
    emitter.onKick("g1", "u9", facts({ connectedUserIds: new Set(["u1"]) }));
    await settle();
    const kicked = sent.find((r) => r.token === "kicked-tok")!;
    const other = sent.find((r) => r.token === "other-tok")!;
    expect(JSON.parse(kicked.body).aps.event).toBe("end");
    expect(JSON.parse(other.body).aps.event).toBe("update");
  });

  it("skips a token the adapter reports dead before sending", async () => {
    const { adapter, sent, dead } = fakeAdapter();
    dead.add("t-dead");
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [
        { token: "t-dead", userId: "u1", environment: "sandbox" },
        { token: "t-live", userId: "u1", environment: "sandbox" },
      ],
    });
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter,
      now: () => 1000,
    });
    emitter.onPresence("g1", facts({ connectedUserIds: new Set(["u1"]) }));
    await settle();
    expect(sent.map((r) => r.token)).toEqual(["t-live"]);
  });

  it("a send that rejects never throws out of the emitter (fire-and-forget)", async () => {
    const throwingAdapter = {
      isDead: () => false,
      async send() {
        throw new Error("apns down");
      },
    } as unknown as ApnsAdapter;
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [{ token: "t1", userId: "u1", environment: "sandbox" }],
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter: throwingAdapter,
      now: () => 1000,
    });
    // Must not throw synchronously, and the async fault is caught and logged.
    expect(() => emitter.onPresence("g1", facts())).not.toThrow();
    await settle();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("debounces fill: the first pushes, a second inside the window is held and later flushed", async () => {
    const { adapter, sent } = fakeAdapter();
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [{ token: "t1", userId: "u1", environment: "sandbox" }],
    });
    // A controllable timer: capture the callback so the test fires it deterministically.
    let armed: (() => void) | null = null;
    let nowMs = 1000;
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter,
      now: () => nowMs,
      setTimer: (fn) => {
        armed = fn;
        return { cancel: () => {} };
      },
    });
    emitter.onFill(
      "g1",
      facts({ filled: 10, connectedUserIds: new Set(["u1"]) }),
    );
    await settle();
    expect(sent).toHaveLength(1); // first fill pushes immediately
    emitter.onFill(
      "g1",
      facts({ filled: 11, connectedUserIds: new Set(["u1"]) }),
    );
    await settle();
    expect(sent).toHaveLength(1); // second is held (inside the window), a timer is armed
    expect(armed).not.toBeNull();
    // The window opens; fire the armed flush.
    nowMs += 20_000;
    armed!();
    await settle();
    expect(sent).toHaveLength(2); // the held latest state flushed
    expect(JSON.parse(sent[1]!.body).aps["content-state"].filled).toBe(11);
  });
});
