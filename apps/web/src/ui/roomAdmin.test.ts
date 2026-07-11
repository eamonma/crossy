// Host-gating for the room-admin controls (INV-8: the session service never mutates membership,
// it verifies; the server is the real gate. These tests pin what the web UI offers, mirroring
// RosterList.selfIsHost/canKick on iOS so both clients show the same affordances).
import { describe, expect, it } from "vitest";
import { canKick, isHost } from "./roomAdmin";

const host = { userId: "host-1", role: "host" as const };
const solver = { userId: "solver-1", role: "solver" as const };
const spectator = { userId: "spectator-1", role: "spectator" as const };
const members = [host, solver, spectator];

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
