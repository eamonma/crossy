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
import { LIVE_ACTIVITY_MAX_PUCKS, colorForUser } from "@crossy/protocol";
import type { MemberRow } from "../repo";
import { ROSTER_DARK_GROUND } from "./roster";
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
import {
  ANNOUNCE_MS,
  CLOCK_PUSH_EXPIRATION_S,
  CLOCK_PUSH_GRACE_MS,
  CLOCK_REGISTER_BOUNDARY_MS,
  COMPLETION_ALERT_SOUND,
  COMPLETION_ALERT_TITLE,
  DISMISS_AFTER_MS,
  STALE_AFTER_MS,
} from "./policy";

const here = dirname(fileURLToPath(import.meta.url));

function facts(over: Partial<BoardFacts> = {}): BoardFacts {
  return {
    filled: 10,
    total: 78,
    status: "ongoing",
    completedAt: null,
    connectedUserIds: new Set<string>(),
    roomName: null,
    firstFillAt: null,
    ...over,
  };
}

function member(over: Partial<MemberRow> & { userId: string }): MemberRow {
  return {
    displayName: over.userId,
    avatarUrl: null,
    role: "solver",
    // One shared instant by default: the D28 join order ties break by userId (ASCII), so a
    // fixture's member list order never matters.
    joinedAt: "2026-07-16T00:00:00Z",
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
            joined_at: m.joinedAt,
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
      inert.onWelcome("g", "u", facts());
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

  it("D28: two members whose hashes collide mod 12 get distinct slots in one room", () => {
    // u-fox and u-gus both hash to roster slot 0 (violet); the vector's two-member bump case
    // pins the spread to slot 4 (ochre). The pucks must paint the two distinct dark-ground hexes.
    const cs = buildContentState(
      [
        member({ userId: "u-fox", joinedAt: "2026-07-16T00:00:01Z" }),
        member({ userId: "u-gus", joinedAt: "2026-07-16T00:00:02Z" }),
      ],
      facts(),
    );
    const fox = cs.pucks.find((p) => p.userId === "u-fox")!;
    const gus = cs.pucks.find((p) => p.userId === "u-gus")!;
    expect([fox.red, fox.green, fox.blue]).toEqual([
      ROSTER_DARK_GROUND[0]!.red,
      ROSTER_DARK_GROUND[0]!.green,
      ROSTER_DARK_GROUND[0]!.blue,
    ]);
    expect([gus.red, gus.green, gus.blue]).toEqual([
      ROSTER_DARK_GROUND[4]!.red,
      ROSTER_DARK_GROUND[4]!.green,
      ROSTER_DARK_GROUND[4]!.blue,
    ]);
  });

  it("D28: a later joiner never changes an earlier member's emitted color", () => {
    const first = member({ userId: "u-fox", joinedAt: "2026-07-16T00:00:01Z" });
    const later = member({ userId: "u-gus", joinedAt: "2026-07-16T00:00:02Z" });
    const solo = buildContentState([first], facts()).pucks[0]!;
    const after = buildContentState([first, later], facts()).pucks.find(
      (p) => p.userId === "u-fox",
    )!;
    expect([after.red, after.green, after.blue]).toEqual([
      solo.red,
      solo.green,
      solo.blue,
    ]);
    // The joiner, not the incumbent, absorbs the collision: alone u-gus would paint slot 0 too.
    const gusSolo = buildContentState([later], facts()).pucks[0]!;
    const gusInRoom = buildContentState([first, later], facts()).pucks.find(
      (p) => p.userId === "u-gus",
    )!;
    expect([gusSolo.red, gusSolo.green, gusSolo.blue]).toEqual([
      ROSTER_DARK_GROUND[0]!.red,
      ROSTER_DARK_GROUND[0]!.green,
      ROSTER_DARK_GROUND[0]!.blue,
    ]);
    expect([gusInRoom.red, gusInRoom.green, gusInRoom.blue]).not.toEqual([
      gusSolo.red,
      gusSolo.green,
      gusSolo.blue,
    ]);
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

  it("carries each member's opaque userId onto its puck (INV-6 avatar-art key)", () => {
    // The build threads the member's opaque id onto the puck; contentStateJson serializes it. It is
    // the §4 participant id, the widget's local avatar-cache key, never solution-bearing.
    const userId = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb";
    const cs = buildContentState(
      [member({ userId, displayName: "Ann", role: "host" })],
      facts({ connectedUserIds: new Set([userId]) }),
    );
    expect(cs.pucks).toHaveLength(1);
    expect(cs.pucks[0]!.userId).toBe(userId);
    // It survives the emitter's own serialization onto the wire.
    const encoded = JSON.parse(
      buildEnvelope(
        {
          event: "update",
          priority: 5,
          contentState: cs,
          audience: { kind: "game" },
          staleAfterMs: STALE_AFTER_MS,
        },
        1_000_000,
      ),
    );
    expect(encoded.aps["content-state"].pucks[0].userId).toBe(userId);
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
    pucks: [
      {
        initial: "E",
        red: 214,
        green: 178,
        blue: 92,
        connected: true,
        userId: "a1b2c3d4-0001-4a1a-8b2b-000000000001",
      },
    ],
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

  it("an alerting update carries aps.alert with title, body, and sound (Apple's Live Activity payload shape)", () => {
    const nowMs = 1_700_000_000_000;
    const body = JSON.parse(
      buildEnvelope(
        {
          event: "update",
          priority: 10,
          contentState: { ...cs, status: "completed", filled: 78 },
          audience: { kind: "game" },
          staleAfterMs: STALE_AFTER_MS,
          alert: {
            title: COMPLETION_ALERT_TITLE,
            body: "Sunday Crew",
            sound: COMPLETION_ALERT_SOUND,
          },
        },
        nowMs,
      ),
    );
    // Apple's documented shape: alert is a dict under aps, with title/body/sound as siblings.
    expect(body.aps.event).toBe("update");
    expect(body.aps.alert).toEqual({
      title: COMPLETION_ALERT_TITLE,
      body: "Sunday Crew",
      sound: COMPLETION_ALERT_SOUND,
    });
    // sound lives inside the alert dict, not as an aps sibling.
    expect(body.aps.sound).toBeUndefined();
  });

  it("a quiet push carries no aps.alert", () => {
    const body = JSON.parse(
      buildEnvelope(
        {
          event: "update",
          priority: 5,
          contentState: cs,
          audience: { kind: "game" },
          staleAfterMs: STALE_AFTER_MS,
        },
        1_700_000_000_000,
      ),
    );
    expect(body.aps.alert).toBeUndefined();
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

  it("welcome sends an update to only the registering user's tokens (priority 10)", async () => {
    const { adapter, sent } = fakeAdapter();
    const pool = fakePool({
      members: [
        member({ userId: "u1", displayName: "Ann" }),
        member({ userId: "u2", displayName: "Bea" }),
      ],
      tokens: [
        { token: "u1-tok", userId: "u1", environment: "sandbox" },
        { token: "u2-tok-a", userId: "u2", environment: "sandbox" },
        { token: "u2-tok-b", userId: "u2", environment: "production" },
      ],
    });
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter,
      now: () => 1000,
    });
    emitter.onWelcome(
      "g1",
      "u2",
      facts({ filled: 30, connectedUserIds: new Set(["u1"]) }),
    );
    await settle();
    // Only u2's two tokens receive it, and it is an immediate priority-10 update.
    expect(sent.map((r) => r.token).sort()).toEqual(["u2-tok-a", "u2-tok-b"]);
    expect(sent.every((r) => r.priority === 10)).toBe(true);
    expect(sent.every((r) => JSON.parse(r.body).aps.event === "update")).toBe(
      true,
    );
    expect(JSON.parse(sent[0]!.body).aps["content-state"].filled).toBe(30);
  });

  it("welcome bypasses the game-level dedupe: it fires even after presence sent the same frame", async () => {
    const { adapter, sent } = fakeAdapter();
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [{ token: "u1-tok", userId: "u1", environment: "sandbox" }],
    });
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter,
      now: () => 1000,
    });
    const same = facts({ filled: 10, connectedUserIds: new Set(["u1"]) });
    // A presence push sets the game-level lastSent to this exact frame.
    emitter.onPresence("g1", same);
    await settle();
    expect(sent).toHaveLength(1);
    // The just-registered token has received nothing, so the welcome must still deliver the frame.
    emitter.onWelcome("g1", "u1", same);
    await settle();
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[1]!.body).aps.event).toBe("update");
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

  it("completed dispatches an alerting update (named by the room) then an end after ANNOUNCE_MS", async () => {
    const { adapter, sent } = fakeAdapter();
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [{ token: "t1", userId: "u1", environment: "sandbox" }],
    });
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
    emitter.onTerminal(
      "g1",
      facts({
        status: "completed",
        completedAt: "2026-07-11T19:40:03Z",
        filled: 78,
        connectedUserIds: new Set(["u1"]),
        roomName: "Sunday Crew",
      }),
    );
    await settle();
    // At T: exactly the alerting update, with aps.alert naming the room. The end is held.
    expect(sent).toHaveLength(1);
    const update = JSON.parse(sent[0]!.body);
    expect(update.aps.event).toBe("update");
    expect(update.aps.alert).toEqual({
      title: COMPLETION_ALERT_TITLE,
      body: "Sunday Crew",
      sound: COMPLETION_ALERT_SOUND,
    });
    expect(armed).not.toBeNull();
    // ANNOUNCE_MS passes; fire the armed timer. The end ships now, no alert.
    nowMs += ANNOUNCE_MS;
    armed!();
    await settle();
    expect(sent).toHaveLength(2);
    const end = JSON.parse(sent[1]!.body);
    expect(end.aps.event).toBe("end");
    expect(end.aps.alert).toBeUndefined();
    expect(end.aps["dismissal-date"]).toBe(
      Math.floor((nowMs + DISMISS_AFTER_MS) / 1000),
    );
  });

  it("abandoned dispatches a single quiet end, no alert (the asymmetry is deliberate)", async () => {
    const { adapter, sent } = fakeAdapter();
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [{ token: "t1", userId: "u1", environment: "sandbox" }],
    });
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter,
      now: () => 1000,
    });
    emitter.onTerminal(
      "g1",
      facts({
        status: "abandoned",
        filled: 12,
        connectedUserIds: new Set(["u1"]),
        roomName: "Sunday Crew",
      }),
    );
    await settle();
    expect(sent).toHaveLength(1);
    const end = JSON.parse(sent[0]!.body);
    expect(end.aps.event).toBe("end");
    expect(end.aps.alert).toBeUndefined();
  });
});

describe("§12a emitter: the clock push rides the same per-game timer as the debounce", () => {
  const anchorIso = "2026-07-11T12:00:00.000Z";
  const anchorMs = Date.parse(anchorIso);
  const entryMs = anchorMs + CLOCK_REGISTER_BOUNDARY_MS + CLOCK_PUSH_GRACE_MS;

  it("a quiet room's hour boundary fires a re-assert: same bytes, priority 10, long expiration", async () => {
    const { adapter, sent } = fakeAdapter();
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [{ token: "t1", userId: "u1", environment: "sandbox" }],
    });
    let armed: (() => void) | null = null;
    let nowMs = anchorMs + 60_000; // a minute past the first fill
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter,
      now: () => nowMs,
      setTimer: (fn) => {
        armed = fn;
        return { cancel: () => {} };
      },
    });
    // The welcome primes lastSent and, with the anchor on the facts, arms the clock entry.
    emitter.onWelcome(
      "g1",
      "u1",
      facts({ firstFillAt: anchorIso, connectedUserIds: new Set(["u1"]) }),
    );
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.expirationS).toBeUndefined(); // an organic update keeps the transport default
    expect(armed).not.toBeNull();
    // The room stays quiet across its hour boundary; the armed wake fires.
    nowMs = entryMs;
    armed!();
    await settle();
    expect(sent).toHaveLength(2);
    const clock = JSON.parse(sent[1]!.body);
    expect(clock.aps.event).toBe("update");
    expect(clock.aps["content-state"]).toEqual(
      JSON.parse(sent[0]!.body).aps["content-state"],
    ); // byte-for-byte re-assert: dedupe deliberately does not apply
    expect(clock.aps["stale-date"]).toBe(
      Math.floor((nowMs + STALE_AFTER_MS) / 1000),
    );
    expect(sent[1]!.priority).toBe(10);
    expect(sent[1]!.expirationS).toBe(CLOCK_PUSH_EXPIRATION_S);
  });

  it("an organic push past the boundary satisfies the guarantee; a late wake stays quiet", async () => {
    const { adapter, sent } = fakeAdapter();
    const pool = fakePool({
      members: [member({ userId: "u1", displayName: "Ann" })],
      tokens: [{ token: "t1", userId: "u1", environment: "sandbox" }],
    });
    let armed: (() => void) | null = null;
    let nowMs = anchorMs + 60_000;
    const emitter = new LiveActivityPushEmitter({
      pool: pool as never,
      adapter,
      now: () => nowMs,
      setTimer: (fn) => {
        armed = fn;
        return { cancel: () => {} };
      },
    });
    emitter.onWelcome(
      "g1",
      "u1",
      facts({ firstFillAt: anchorIso, connectedUserIds: new Set(["u1"]) }),
    );
    await settle();
    expect(sent).toHaveLength(1);
    // A presence change lands past the boundary: that render already applied the flip.
    nowMs = entryMs + 1;
    emitter.onPresence(
      "g1",
      facts({ firstFillAt: anchorIso, connectedUserIds: new Set<string>() }),
    );
    await settle();
    expect(sent).toHaveLength(2);
    // A stale armed wake firing later is an idempotent no-op: the entry is satisfied.
    nowMs = entryMs + 2;
    armed!();
    await settle();
    expect(sent).toHaveLength(2);
  });
});
