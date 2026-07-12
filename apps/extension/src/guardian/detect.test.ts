import { describe, expect, it } from "vitest";
import { isGuardianCrosswordPage } from "./detect";

describe("isGuardianCrosswordPage", () => {
  it("accepts the live-confirmed puzzle page shapes", () => {
    expect(
      isGuardianCrosswordPage(
        "https://www.theguardian.com/crosswords/quick/17000",
      ),
    ).toBe(true);
    expect(
      isGuardianCrosswordPage(
        "https://www.theguardian.com/crosswords/cryptic/30053",
      ),
    ).toBe(true);
  });

  it("accepts the bare host and hyphenated puzzle types", () => {
    expect(
      isGuardianCrosswordPage(
        "https://theguardian.com/crosswords/quick-cryptic/100",
      ),
    ).toBe(true);
  });

  it("rejects crossword pages that are not a puzzle", () => {
    expect(
      isGuardianCrosswordPage("https://www.theguardian.com/crosswords"),
    ).toBe(false);
    expect(
      isGuardianCrosswordPage(
        "https://www.theguardian.com/crosswords/series/cryptic",
      ),
    ).toBe(false);
    expect(
      isGuardianCrosswordPage(
        "https://www.theguardian.com/crosswords/accessible/quick/17000",
      ),
    ).toBe(false);
  });

  it("rejects other hosts, including lookalike suffixes", () => {
    expect(
      isGuardianCrosswordPage(
        "https://theguardian.com.example/crosswords/quick/1",
      ),
    ).toBe(false);
    expect(
      isGuardianCrosswordPage("https://example.com/crosswords/quick/1"),
    ).toBe(false);
  });

  it("rejects non-https and non-URL input", () => {
    expect(
      isGuardianCrosswordPage("http://www.theguardian.com/crosswords/quick/1"),
    ).toBe(false);
    expect(isGuardianCrosswordPage("not a url")).toBe(false);
  });
});
