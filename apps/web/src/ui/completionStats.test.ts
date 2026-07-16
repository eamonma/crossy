// The completion card renders only wire-carried facts (PROTOCOL.md section 4 stats;
// INV-6 corollary: nothing solution-derivable exists to leak here, and nothing is
// fabricated when a stat is absent).
import { describe, expect, it } from "vitest";
import { celebrationPalette, completionCells } from "./completionStats";

describe("completionCells", () => {
  it("renders the wire stats verbatim: time, solvers, entries (PROTOCOL §4)", () => {
    const cells = completionCells(
      {
        solveTimeSeconds: 2272,
        totalEvents: 899,
        participantCount: 4,
        checkCount: 0,
      },
      0,
    );
    expect(cells.map((c) => c.key)).toEqual(["time", "solvers", "entries"]);
    expect(cells[0]).toMatchObject({ label: "Time", value: "37:52" });
    expect(cells[1]).toMatchObject({ label: "Solvers", value: "4" });
    expect(cells[2]).toMatchObject({ label: "Entries", value: "899" });
  });

  it("prefers the server's solveTimeSeconds over the derived fallback", () => {
    const cells = completionCells(
      {
        solveTimeSeconds: 61,
        totalEvents: 1,
        participantCount: 1,
        checkCount: 0,
      },
      999,
    );
    expect(cells[0]!.value).toBe("1:01");
  });

  it("falls back to the derived timer and placeholders when stats are absent, never a guess", () => {
    const cells = completionCells(null, 125);
    expect(cells[0]!.value).toBe("2:05");
    expect(cells[1]!.value).toBe("—");
    expect(cells[2]!.value).toBe("—");
  });

  it("makes active time THE time when stats carry it, with the count as context (D29)", () => {
    const cells = completionCells(
      {
        solveTimeSeconds: 29160,
        totalEvents: 899,
        participantCount: 4,
        checkCount: 0,
        activeSolveSeconds: 360,
        sittingCount: 2,
      },
      0,
    );
    // The headline is the active 6:00, never the 8:06:00 wall night; the count rides under it.
    expect(cells[0]).toMatchObject({ value: "6:00", context: "2 sittings" });
  });

  it("renders no sittings context for a single sitting (reads exactly as today, D29)", () => {
    const cells = completionCells(
      {
        solveTimeSeconds: 2272,
        totalEvents: 899,
        participantCount: 4,
        checkCount: 0,
        activeSolveSeconds: 2272,
        sittingCount: 1,
      },
      0,
    );
    expect(cells[0]).toMatchObject({ value: "37:52", context: null });
  });

  it("falls back to the wall-clock time on stats frozen before sittings shipped (PROTOCOL §4)", () => {
    const cells = completionCells(
      {
        solveTimeSeconds: 2272,
        totalEvents: 899,
        participantCount: 4,
        checkCount: 0,
      },
      0,
    );
    expect(cells[0]).toMatchObject({ value: "37:52", context: null });
  });

  it("keeps a stable three-cell shape either way, so the grid never reflows", () => {
    expect(completionCells(null, 0)).toHaveLength(3);
    expect(
      completionCells(
        {
          solveTimeSeconds: 1,
          totalEvents: 1,
          participantCount: 1,
          checkCount: 0,
        },
        0,
      ),
    ).toHaveLength(3);
  });
});

describe("celebrationPalette", () => {
  it("leads with the house gold scale (styles.css --color-gold-5..9)", () => {
    const palette = celebrationPalette([]);
    expect(palette).toEqual([
      "#e1dccf",
      "#d8d0bf",
      "#cbc0a8",
      "#b9a88d",
      "#978365",
    ]);
  });

  it("warms each person's hash color toward gold, never ships the raw primary", () => {
    const palette = celebrationPalette([
      { color: "#3e63dd", role: "solver" },
      { color: "#e5484d", role: "host" },
    ]);
    // The base gold field leads unchanged; the people follow as warm tints.
    expect(palette.slice(0, 5)).toEqual([
      "#e1dccf",
      "#d8d0bf",
      "#cbc0a8",
      "#b9a88d",
      "#978365",
    ]);
    // No raw roster primary survives into the field.
    expect(palette).not.toContain("#3e63dd");
    expect(palette).not.toContain("#e5484d");
    // Each person contributes exactly one tinted fleck color, pulled toward gold-8.
    expect(palette).toHaveLength(7);
    for (const c of palette.slice(5)) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("lends spectators no color: they watched, they did not write", () => {
    const palette = celebrationPalette([
      { color: "#3e63dd", role: "spectator" },
    ]);
    // The spectator's hue never enters, even tinted; only the house golds remain.
    expect(palette).toEqual(celebrationPalette([]));
  });

  it("survives a malformed hash color by leaving the field its warm anchor", () => {
    const palette = celebrationPalette([
      { color: "not-a-color", role: "host" },
    ]);
    expect(palette).toHaveLength(6);
    expect(palette[5]).toBe("#b9a88d"); // the gold-8 anchor
  });

  it("celebrates in the house golds when the roster is empty", () => {
    expect(celebrationPalette([])).toHaveLength(5);
  });
});
