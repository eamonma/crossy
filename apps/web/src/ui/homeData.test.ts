// The home's pure formatters. These are display helpers, not invariant guards, so the names
// describe behavior rather than citing an INV-n. The `now` parameter is what makes them
// deterministic to pin.
import { describe, expect, it } from "vitest";
import {
  featureLabels,
  gameTitle,
  geometry,
  relativeTime,
  shortDate,
  type GameSummary,
} from "./homeData";

// Local wall-clock noon so the calendar reads (getMonth/getDate/getFullYear the formatters use)
// are timezone-independent: `now` and every input below are read in the same local zone.
const NOW = new Date(2026, 6, 9, 12, 0, 0);

// relativeTime is a delta (now - then), so a UTC instant is fine for it.
function iso(daysAgo: number, hoursAgo = 0): string {
  return new Date(
    NOW.getTime() - daysAgo * 86_400_000 - hoursAgo * 3_600_000,
  ).toISOString();
}

function game(over: Partial<GameSummary> = {}): GameSummary {
  return {
    gameId: "g1",
    name: null,
    role: "host",
    createdAt: "2026-07-09T12:00:00",
    createdBy: "u1",
    memberCount: 1,
    puzzle: { puzzleId: "p1", rows: 15, cols: 15 },
    ...over,
  };
}

describe("geometry", () => {
  it("writes cols by rows with the multiply glyph", () => {
    expect(geometry(15, 15)).toBe("15 × 15");
    expect(geometry(5, 7)).toBe("5 × 7");
  });
});

describe("shortDate", () => {
  it("omits the year within the current year", () => {
    expect(shortDate("2026-07-09T12:00:00", NOW)).toBe("Jul 9");
  });
  it("shows the year when it differs from now", () => {
    expect(shortDate("2024-02-04T12:00:00", NOW)).toBe("Feb 4, 2024");
  });
  it("is empty for an unparseable date", () => {
    expect(shortDate("not-a-date", NOW)).toBe("");
  });
});

describe("gameTitle", () => {
  it("prefers a trimmed name", () => {
    expect(gameTitle(game({ name: "  Sunday themeless  " }), NOW)).toBe(
      "Sunday themeless",
    );
  });
  it("falls back to geometry and date when unnamed", () => {
    expect(gameTitle(game({ name: null, createdAt: iso(0) }), NOW)).toBe(
      "15 × 15 · Jul 9",
    );
  });
  it("treats an empty name as unnamed", () => {
    expect(gameTitle(game({ name: "   " }), NOW)).toBe("15 × 15 · Jul 9");
  });
});

describe("featureLabels", () => {
  it("is empty when there are no features", () => {
    expect(featureLabels(null)).toEqual([]);
    expect(featureLabels({})).toEqual([]);
  });
  it("lists present features in a fixed order", () => {
    expect(
      featureLabels({ shadedCircles: true, rebus: true, circles: true }),
    ).toEqual(["Rebus", "Circles", "Shaded"]);
  });
});

describe("relativeTime", () => {
  it("reads recent moments as just now", () => {
    expect(relativeTime(iso(0, 0), NOW)).toBe("just now");
  });
  it("uses one largest unit, unabbreviated", () => {
    expect(relativeTime(iso(2), NOW)).toBe("2 days ago");
    expect(relativeTime(iso(1), NOW)).toBe("yesterday");
    expect(relativeTime(iso(0, 3), NOW)).toBe("3 hours ago");
    expect(relativeTime(iso(14), NOW)).toBe("2 weeks ago");
  });
  it("clamps a future timestamp to just now rather than reading as the future", () => {
    const future = new Date(NOW.getTime() + 3 * 3_600_000).toISOString();
    expect(relativeTime(future, NOW)).toBe("just now");
  });
});
