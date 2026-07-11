// The solving-now roster derivation: connected hosts/solvers become rows (self first,
// reading the local selection), spectators become the watching line, and grouping keys
// on the clue so a crowded room stays bounded. Cursors are best-effort presence
// (PROTOCOL.md section 9): a missing or off-word cursor never drops a person, only
// their clue.
import { describe, expect, it } from "vitest";
import type { Cursor, Participant } from "@crossy/protocol";
import type { Clue } from "../domain/types";
import { buildRoster, cluePresence } from "./roster";

// A 3x3 open grid: across words on each row, down words on each column.
const across: Clue[] = [
  { number: 1, direction: "across", cells: [0, 1, 2], text: "Row one" },
  { number: 4, direction: "across", cells: [3, 4, 5], text: "Row two" },
  { number: 5, direction: "across", cells: [6, 7, 8], text: "Row three" },
];
const down: Clue[] = [
  { number: 1, direction: "down", cells: [0, 3, 6], text: "Col one" },
  { number: 2, direction: "down", cells: [1, 4, 7], text: "Col two" },
  { number: 3, direction: "down", cells: [2, 5, 8], text: "Col three" },
];

function person(
  userId: string,
  role: Participant["role"],
  connected = true,
  avatarUrl: string | null = null,
): Participant {
  return {
    userId,
    displayName: userId,
    avatarUrl,
    color: "#3e63dd",
    role,
    connected,
  };
}

function cursorMap(
  entries: Array<[string, number, Cursor["direction"]]>,
): Map<string, Cursor> {
  return new Map(
    entries.map(([userId, cell, direction]) => [
      userId,
      { userId, cell, direction },
    ]),
  );
}

describe("buildRoster", () => {
  it("puts self first with the local selection, teammates in store order", () => {
    const roster = buildRoster({
      participants: [person("mia", "solver"), person("me", "host")],
      cursors: cursorMap([["mia", 4, "across"]]),
      selfUserId: "me",
      selfSelection: { cell: 0, direction: "down" },
      across,
      down,
    });
    expect(roster.solvers.map((s) => s.name)).toEqual(["You", "mia"]);
    expect(roster.solvers[0]?.clue?.number).toBe(1);
    expect(roster.solvers[0]?.clue?.direction).toBe("down");
    expect(roster.solvers[1]?.clue?.text).toBe("Row two");
  });

  it("carries each solver's avatarUrl through, null a first-class value (PROTOCOL.md §4)", () => {
    const roster = buildRoster({
      participants: [
        person("me", "host", true, "https://cdn.example/me.png"),
        person("mia", "solver", true, null),
      ],
      cursors: cursorMap([["mia", 4, "across"]]),
      selfUserId: "me",
      selfSelection: { cell: 0, direction: "down" },
      across,
      down,
    });
    const byId = new Map(roster.solvers.map((s) => [s.userId, s.avatarUrl]));
    expect(byId.get("me")).toBe("https://cdn.example/me.png");
    // A teammate with no avatar renders their initial: avatarUrl stays null, never undefined.
    expect(byId.get("mia")).toBeNull();
  });

  it("counts connected spectators as watching, never as solvers", () => {
    const roster = buildRoster({
      participants: [
        person("me", "host"),
        person("ivy", "spectator"),
        person("gone", "spectator", false),
      ],
      cursors: cursorMap([]),
      selfUserId: "me",
      selfSelection: { cell: 0, direction: "across" },
      across,
      down,
    });
    expect(roster.solvers).toHaveLength(1);
    expect(roster.watching).toEqual(["ivy"]);
  });

  it("drops disconnected members and keeps cursorless solvers without a clue", () => {
    const roster = buildRoster({
      participants: [
        person("me", "host"),
        person("offline", "solver", false),
        person("browsing", "solver"),
      ],
      cursors: cursorMap([]),
      selfUserId: "me",
      selfSelection: { cell: 0, direction: "across" },
      across,
      down,
    });
    expect(roster.solvers.map((s) => s.name)).toEqual(["You", "browsing"]);
    expect(roster.solvers[1]?.clue).toBeNull();
    expect(roster.groups).toHaveLength(1);
  });

  it("groups by clue, ordered by number with across before down", () => {
    const roster = buildRoster({
      participants: [
        person("me", "solver"),
        person("mia", "solver"),
        person("jules", "solver"),
        person("sam", "solver"),
      ],
      cursors: cursorMap([
        ["mia", 4, "across"],
        ["jules", 0, "down"],
        ["sam", 3, "down"],
      ]),
      selfUserId: "me",
      selfSelection: { cell: 1, direction: "across" },
      across,
      down,
    });
    // Self on 1-Across, jules and sam both on 1-Down, mia on 4-Across.
    expect(
      roster.groups.map((g) => `${g.clue.number}${g.clue.direction[0]}`),
    ).toEqual(["1a", "1d", "4a"]);
    expect(roster.groups[1]?.people.map((p) => p.name)).toEqual([
      "jules",
      "sam",
    ]);
  });

  it("spectating self contributes no solver row and no watching entry", () => {
    const roster = buildRoster({
      participants: [person("me", "spectator"), person("mia", "solver")],
      cursors: cursorMap([["mia", 6, "across"]]),
      selfUserId: "me",
      selfSelection: null,
      across,
      down,
    });
    expect(roster.solvers.map((s) => s.name)).toEqual(["mia"]);
    expect(roster.watching).toEqual([]);
  });
});

// Presence in the lists (PROTOCOL.md section 9): the roster re-keyed by clue so a clue row can
// mark itself with the teammates on it. Self is dropped (their position is the amber active row),
// disconnected members and spectators never reach the roster, and no cursors means no dots.
describe("cluePresence", () => {
  function presenceOf(
    opts: Parameters<typeof buildRoster>[0],
  ): Map<string, readonly string[]> {
    const map = cluePresence(buildRoster(opts));
    return new Map(
      [...map].map(([key, people]) => [key, people.map((p) => p.name)]),
    );
  }

  it("keys teammates by clue and never marks the self row", () => {
    const presence = presenceOf({
      participants: [person("me", "host"), person("mia", "solver")],
      cursors: cursorMap([["mia", 4, "across"]]),
      selfUserId: "me",
      // Self sits on 1-Across; it stays the amber row, never a dot.
      selfSelection: { cell: 0, direction: "across" },
      across,
      down,
    });
    expect([...presence.keys()]).toEqual(["across-4"]);
    expect(presence.get("across-4")).toEqual(["mia"]);
  });

  it("lists every teammate on a shared clue in roster order", () => {
    const presence = presenceOf({
      participants: [
        person("me", "solver"),
        person("jules", "solver"),
        person("sam", "solver"),
      ],
      cursors: cursorMap([
        ["jules", 0, "down"],
        ["sam", 6, "down"],
      ]),
      selfUserId: "me",
      selfSelection: { cell: 1, direction: "across" },
      across,
      down,
    });
    expect(presence.get("down-1")).toEqual(["jules", "sam"]);
  });

  it("leaves no dot for a disconnected teammate", () => {
    const presence = presenceOf({
      participants: [person("me", "host"), person("gone", "solver", false)],
      cursors: cursorMap([["gone", 4, "across"]]),
      selfUserId: "me",
      selfSelection: { cell: 0, direction: "across" },
      across,
      down,
    });
    expect(presence.size).toBe(0);
  });

  it("leaves no dot for a spectating teammate", () => {
    const presence = presenceOf({
      participants: [person("me", "host"), person("ivy", "spectator")],
      cursors: cursorMap([["ivy", 4, "across"]]),
      selfUserId: "me",
      selfSelection: { cell: 0, direction: "across" },
      across,
      down,
    });
    expect(presence.size).toBe(0);
  });

  it("is empty when no teammate has a resolvable cursor", () => {
    const presence = presenceOf({
      participants: [person("me", "host"), person("browsing", "solver")],
      cursors: cursorMap([]),
      selfUserId: "me",
      selfSelection: { cell: 0, direction: "across" },
      across,
      down,
    });
    expect(presence.size).toBe(0);
  });
});
