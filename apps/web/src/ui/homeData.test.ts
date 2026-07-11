// The home's pure formatters, plus the fetchers' bearer resolution. These are display
// helpers, not invariant guards, so the names describe behavior rather than citing an
// INV-n. The `now` parameter is what makes the formatters deterministic to pin.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compactTime,
  featureLabels,
  fetchGames,
  gameTitle,
  geometry,
  isCompleted,
  lastTouched,
  puzzleTitle,
  relativeTime,
  shortDate,
  sortByActivity,
  type GameSummary,
  type PuzzleSummary,
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

// A placeholder all-playable silhouette sized to the fixture geometry; the formatter tests below
// never read the mask, so a plain grid keeps the builders honest to the shape without noise.
const PLAIN_15 = Array.from({ length: 15 }, () => ".".repeat(15));

function game(over: Partial<GameSummary> = {}): GameSummary {
  return {
    gameId: "g1",
    name: null,
    role: "host",
    createdAt: "2026-07-09T12:00:00",
    createdBy: "u1",
    memberCount: 1,
    completedAt: null,
    lastActivityAt: null,
    puzzle: { puzzleId: "p1", rows: 15, cols: 15, title: null, mask: PLAIN_15 },
    ...over,
  };
}

function puzzle(over: Partial<PuzzleSummary> = {}): PuzzleSummary {
  return {
    puzzleId: "p1",
    createdAt: "2026-07-09T12:00:00",
    rows: 15,
    cols: 15,
    features: null,
    title: null,
    author: null,
    mask: PLAIN_15,
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
  it("falls back to the puzzle's title when the room is unnamed", () => {
    const g = game({
      name: null,
      puzzle: {
        puzzleId: "p1",
        rows: 15,
        cols: 15,
        title: "NYT 2026-07-05",
        mask: PLAIN_15,
      },
    });
    expect(gameTitle(g, NOW)).toBe("NYT 2026-07-05");
  });
  it("falls back to geometry and date when unnamed and untitled", () => {
    expect(gameTitle(game({ name: null, createdAt: iso(0) }), NOW)).toBe(
      "15 × 15 · Jul 9",
    );
  });
  it("treats an empty name as unnamed", () => {
    expect(gameTitle(game({ name: "   " }), NOW)).toBe("15 × 15 · Jul 9");
  });
});

describe("isCompleted", () => {
  it("is false while ongoing (completedAt null)", () => {
    expect(isCompleted(game({ completedAt: null }))).toBe(false);
  });
  it("is true once a completion timestamp is present", () => {
    expect(isCompleted(game({ completedAt: "2026-07-08T10:00:00Z" }))).toBe(
      true,
    );
  });
});

describe("lastTouched", () => {
  it("is the activity time when the game has been played", () => {
    expect(
      lastTouched(
        game({
          createdAt: "2026-07-01T12:00:00Z",
          lastActivityAt: "2026-07-08T09:00:00Z",
        }),
      ),
    ).toBe("2026-07-08T09:00:00Z");
  });
  it("falls back to createdAt for an unplayed game", () => {
    expect(
      lastTouched(
        game({ createdAt: "2026-07-01T12:00:00Z", lastActivityAt: null }),
      ),
    ).toBe("2026-07-01T12:00:00Z");
  });
});

describe("sortByActivity (matches the server's within-page order, PROTOCOL section 12)", () => {
  it("puts the most recently active game first", () => {
    const a = game({ gameId: "a", lastActivityAt: "2026-07-01T00:00:00Z" });
    const b = game({ gameId: "b", lastActivityAt: "2026-07-03T00:00:00Z" });
    const c = game({ gameId: "c", lastActivityAt: "2026-07-02T00:00:00Z" });
    expect(sortByActivity([a, b, c]).map((g) => g.gameId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
  it("sorts a played game ahead of an unplayed one, whatever the createdAt", () => {
    const played = game({
      gameId: "played",
      createdAt: "2026-01-01T00:00:00Z",
      lastActivityAt: "2026-06-01T00:00:00Z",
    });
    const unplayed = game({
      gameId: "unplayed",
      createdAt: "2026-05-01T00:00:00Z",
      lastActivityAt: null,
    });
    expect(sortByActivity([unplayed, played]).map((g) => g.gameId)).toEqual([
      "played",
      "unplayed",
    ]);
  });
  it("orders unplayed games by createdAt, newest first", () => {
    const older = game({
      gameId: "older",
      createdAt: "2026-05-01T00:00:00Z",
      lastActivityAt: null,
    });
    const newer = game({
      gameId: "newer",
      createdAt: "2026-05-09T00:00:00Z",
      lastActivityAt: null,
    });
    expect(sortByActivity([older, newer]).map((g) => g.gameId)).toEqual([
      "newer",
      "older",
    ]);
  });
  it("does not mutate its input", () => {
    const input = [
      game({ gameId: "a", lastActivityAt: "2026-07-01T00:00:00Z" }),
      game({ gameId: "b", lastActivityAt: "2026-07-03T00:00:00Z" }),
    ];
    const before = input.map((g) => g.gameId);
    sortByActivity(input);
    expect(input.map((g) => g.gameId)).toEqual(before);
  });
});

describe("puzzleTitle", () => {
  it("prefers the parsed title, trimmed", () => {
    expect(puzzleTitle(puzzle({ title: "  Themeless 42 " }))).toBe(
      "Themeless 42",
    );
  });
  it("reads Untitled when the document carried none", () => {
    expect(puzzleTitle(puzzle({ title: null }))).toBe("Untitled");
    expect(puzzleTitle(puzzle({ title: "  " }))).toBe("Untitled");
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

describe("compactTime (sidebar rows)", () => {
  it("uses one largest unit, abbreviated", () => {
    expect(compactTime(iso(0, 0), NOW)).toBe("now");
    expect(compactTime(iso(0, 3), NOW)).toBe("3h");
    expect(compactTime(iso(2), NOW)).toBe("2d");
    expect(compactTime(iso(14), NOW)).toBe("2w");
    expect(compactTime(iso(90), NOW)).toBe("3mo");
    expect(compactTime(iso(800), NOW)).toBe("2y");
  });
  it("clamps a future timestamp to now and is empty for garbage", () => {
    const future = new Date(NOW.getTime() + 3_600_000).toISOString();
    expect(compactTime(future, NOW)).toBe("now");
    expect(compactTime("not-a-date", NOW)).toBe("");
  });
});

describe("bearer resolution (fetchers take a token source, not a string)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves the bearer through the source on every call, so a long-lived tab never rides a frozen token", async () => {
    const sent: (string | undefined)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push((init?.headers as Record<string, string>)["authorization"]);
        return new Response(JSON.stringify({ games: [] }));
      }),
    );
    const tokens = ["token-at-noon", "token-an-hour-later"];
    const getToken = () => Promise.resolve(tokens.shift() ?? null);

    await fetchGames("https://api", getToken);
    await fetchGames("https://api", getToken);

    expect(sent).toEqual([
      "Bearer token-at-noon",
      "Bearer token-an-hour-later",
    ]);
  });

  it("refuses to dial signed out: a null token throws before any fetch", async () => {
    const dialed = vi.fn();
    vi.stubGlobal("fetch", dialed);

    await expect(
      fetchGames("https://api", () => Promise.resolve(null)),
    ).rejects.toThrow();
    expect(dialed).not.toHaveBeenCalled();
  });
});
