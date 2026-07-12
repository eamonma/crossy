import { describe, expect, it } from "vitest";
import { isNytCrosswordGamePage, nytPuzzleEndpoint } from "./detect";

describe("isNytCrosswordGamePage", () => {
  it("accepts the crossword game pages (mini probed, daily by the same mechanism)", () => {
    expect(
      isNytCrosswordGamePage("https://www.nytimes.com/crosswords/game/mini"),
    ).toBe(true);
    expect(
      isNytCrosswordGamePage("https://www.nytimes.com/crosswords/game/daily"),
    ).toBe(true);
  });

  it("rejects the crossword hub and non-game crossword pages", () => {
    expect(isNytCrosswordGamePage("https://www.nytimes.com/crosswords")).toBe(
      false,
    );
    expect(
      isNytCrosswordGamePage("https://www.nytimes.com/crosswords/game"),
    ).toBe(false);
  });

  it("rejects other hosts, including lookalike suffixes", () => {
    expect(
      isNytCrosswordGamePage(
        "https://nytimes.com.example/crosswords/game/mini",
      ),
    ).toBe(false);
    expect(
      isNytCrosswordGamePage(
        "https://www.nytimes.com.evil.com/crosswords/game/mini",
      ),
    ).toBe(false);
    expect(
      isNytCrosswordGamePage("https://example.com/crosswords/game/mini"),
    ).toBe(false);
  });

  it("rejects non-https and non-URL input", () => {
    expect(
      isNytCrosswordGamePage("http://www.nytimes.com/crosswords/game/mini"),
    ).toBe(false);
    expect(isNytCrosswordGamePage("not a url")).toBe(false);
  });
});

describe("nytPuzzleEndpoint", () => {
  it("locates the same-origin v6 puzzle path from the stream in the URL", () => {
    expect(
      nytPuzzleEndpoint("https://www.nytimes.com/crosswords/game/mini"),
    ).toBe("/svc/crosswords/v6/puzzle/mini.json");
    expect(
      nytPuzzleEndpoint("https://www.nytimes.com/crosswords/game/daily/"),
    ).toBe("/svc/crosswords/v6/puzzle/daily.json");
  });

  it("maps a dated game page to the dated endpoint (slashes in, dashes out)", () => {
    expect(
      nytPuzzleEndpoint(
        "https://www.nytimes.com/crosswords/game/daily/2026/07/12",
      ),
    ).toBe("/svc/crosswords/v6/puzzle/daily/2026-07-12.json");
    expect(
      nytPuzzleEndpoint(
        "https://www.nytimes.com/crosswords/game/mini/2026/07/12/",
      ),
    ).toBe("/svc/crosswords/v6/puzzle/mini/2026-07-12.json");
  });

  it("returns null for paths that are neither a stream nor a dated stream", () => {
    expect(
      nytPuzzleEndpoint("https://www.nytimes.com/crosswords/game/daily/2026"),
    ).toBeNull();
    expect(
      nytPuzzleEndpoint(
        "https://www.nytimes.com/crosswords/game/daily/2026/7/12",
      ),
    ).toBeNull();
    expect(
      nytPuzzleEndpoint(
        "https://www.nytimes.com/crosswords/game/daily/2026/07/12/extra",
      ),
    ).toBeNull();
    expect(nytPuzzleEndpoint("not a url")).toBeNull();
  });
});
