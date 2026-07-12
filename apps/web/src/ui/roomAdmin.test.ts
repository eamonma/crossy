// Host-gating for the room-admin controls (INV-8: the session service never mutates membership,
// it verifies; the server is the real gate. These tests pin what the web UI offers, mirroring
// RosterList.selfIsHost/canKick on iOS so both clients show the same affordances).
import { describe, expect, it } from "vitest";
import type { StackMember } from "./primitives";
import { canKick, isHost, partitionRoster } from "./roomAdmin";

const host = { userId: "host-1", role: "host" as const };
const solver = { userId: "solver-1", role: "solver" as const };
const spectator = { userId: "spectator-1", role: "spectator" as const };
const members = [host, solver, spectator];

/** A StackMember for the presence-split tests: only userId, role, and connected vary. */
function stackMember(
  userId: string,
  role: StackMember["role"],
  connected: boolean,
): StackMember {
  return {
    userId,
    name: userId,
    initial: userId.charAt(0).toUpperCase(),
    avatarUrl: null,
    color: "#3e63dd",
    connected,
    role,
  };
}

describe("isHost", () => {
  it("INV-8: true when the local participant's role is host", () => {
    expect(isHost(members, "host-1")).toBe(true);
  });

  it("INV-8: false for a solver or spectator", () => {
    expect(isHost(members, "solver-1")).toBe(false);
    expect(isHost(members, "spectator-1")).toBe(false);
  });

  it("INV-8: false for an absent or unknown self id", () => {
    expect(isHost(members, null)).toBe(false);
    expect(isHost(members, "nobody")).toBe(false);
  });

  it("INV-8: false in an empty room", () => {
    expect(isHost([], "host-1")).toBe(false);
  });
});

describe("canKick", () => {
  it("allows the host to target any other member", () => {
    expect(canKick(solver, "host-1")).toBe(true);
    expect(canKick(spectator, "host-1")).toBe(true);
  });

  it("never offers the host's own row (server refuses self-target with FORBIDDEN)", () => {
    expect(canKick(host, "host-1")).toBe(false);
  });

  it("false for an absent self id", () => {
    expect(canKick(solver, null)).toBe(false);
  });
});

// The Players panel presence split (PROTOCOL.md §4: `connected` on every participant, no wire
// change). The people here now lead; away members gather below. The rule mirrors the AvatarStack
// display rule (primitives.tsx) so the trigger stack and the open panel agree on who is away.
describe("partitionRoster", () => {
  it("leads with connected members and gathers the away below, order preserved", () => {
    const roster = [
      stackMember("me", "host", true),
      stackMember("ada", "solver", false),
      stackMember("bee", "solver", true),
      stackMember("cy", "solver", false),
    ];
    const { online, away } = partitionRoster(roster, "me");
    // Store order holds inside each section: no reshuffle, only a split.
    expect(online.map((m) => m.userId)).toEqual(["me", "bee"]);
    expect(away.map((m) => m.userId)).toEqual(["ada", "cy"]);
  });

  it("keeps the viewer online even when their own connected flag is false", () => {
    // A self row can echo connected:false mid-reconnect; the viewer is present by definition.
    const roster = [
      stackMember("me", "solver", false),
      stackMember("bee", "solver", true),
    ];
    const { online, away } = partitionRoster(roster, "me");
    expect(online.map((m) => m.userId)).toEqual(["me", "bee"]);
    expect(away).toHaveLength(0);
  });

  it("preserves host markers in either section (the row still carries role)", () => {
    const roster = [
      stackMember("host-here", "host", true),
      stackMember("host-away", "host", false),
    ];
    const { online, away } = partitionRoster(roster, "solver-x");
    expect(online[0]?.role).toBe("host");
    expect(away[0]?.role).toBe("host");
  });

  it("moves a member between sections live as their connected flag flips", () => {
    const connected = [stackMember("bee", "solver", true)];
    const disconnected = [stackMember("bee", "solver", false)];
    expect(
      partitionRoster(connected, "me").online.map((m) => m.userId),
    ).toEqual(["bee"]);
    expect(partitionRoster(connected, "me").away).toHaveLength(0);
    expect(
      partitionRoster(disconnected, "me").away.map((m) => m.userId),
    ).toEqual(["bee"]);
    expect(partitionRoster(disconnected, "me").online).toHaveLength(0);
  });

  it("yields an empty away section when everyone is here (no ghost heading)", () => {
    const roster = [
      stackMember("me", "host", true),
      stackMember("bee", "solver", true),
    ];
    expect(partitionRoster(roster, "me").away).toHaveLength(0);
  });

  it("drops a disconnected spectator from both sections (no permanent away ghost, PROTOCOL.md §12)", () => {
    // A guest seats as a spectator; once away they are neither here nor a lingering away ghost.
    const roster = [
      stackMember("me", "host", true),
      stackMember("guest", "spectator", false),
    ];
    const { online, away } = partitionRoster(roster, "me");
    expect(online.map((m) => m.userId)).toEqual(["me"]);
    expect(away).toHaveLength(0);
  });

  it("keeps a connected spectator in the here section", () => {
    const roster = [
      stackMember("me", "host", true),
      stackMember("watcher", "spectator", true),
    ];
    const { online, away } = partitionRoster(roster, "me");
    expect(online.map((m) => m.userId)).toEqual(["me", "watcher"]);
    expect(away).toHaveLength(0);
  });
});
