// The completion card renders only wire-carried facts (PROTOCOL.md section 4 stats;
// INV-6 corollary: nothing solution-derivable exists to leak here, and nothing is
// fabricated when a stat is absent).
import { describe, expect, it } from "vitest";
import { celebrationPalette, completionCells } from "./completionStats";

describe("completionCells", () => {
  it("renders the wire stats verbatim: time, solvers, entries (PROTOCOL §4)", () => {
    const cells = completionCells(
      { solveTimeSeconds: 2272, totalEvents: 899, participantCount: 4 },
      0,
    );
    expect(cells.map((c) => c.key)).toEqual(["time", "solvers", "entries"]);
    expect(cells[0]).toMatchObject({ label: "Time", value: "37:52" });
    expect(cells[1]).toMatchObject({ label: "Solvers", value: "4" });
    expect(cells[2]).toMatchObject({ label: "Entries", value: "899" });
  });

  it("prefers the server's solveTimeSeconds over the derived fallback", () => {
    const cells = completionCells(
      { solveTimeSeconds: 61, totalEvents: 1, participantCount: 1 },
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

  it("keeps a stable three-cell shape either way, so the grid never reflows", () => {
    expect(completionCells(null, 0)).toHaveLength(3);
    expect(
      completionCells(
        { solveTimeSeconds: 1, totalEvents: 1, participantCount: 1 },
        0,
      ),
    ).toHaveLength(3);
  });
});

describe("celebrationPalette", () => {
  it("leads with the house golds and doubles the people's roster colors", () => {
    const palette = celebrationPalette([
      { color: "#3e63dd", role: "solver" },
      { color: "#e5484d", role: "host" },
    ]);
    expect(palette.slice(0, 4)).toEqual([
      "#978365",
      "#b9a88d",
      "#cbc0a8",
      "#e1dccf",
    ]);
    expect(palette.filter((c) => c === "#3e63dd")).toHaveLength(2);
    expect(palette.filter((c) => c === "#e5484d")).toHaveLength(2);
  });

  it("lends spectators no color: they watched, they did not write", () => {
    const palette = celebrationPalette([
      { color: "#3e63dd", role: "spectator" },
    ]);
    expect(palette).not.toContain("#3e63dd");
    expect(palette.length).toBeGreaterThan(0);
  });

  it("celebrates in the house golds when the roster is empty", () => {
    expect(celebrationPalette([])).toHaveLength(4);
  });
});
