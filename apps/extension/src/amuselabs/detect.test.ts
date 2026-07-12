import { describe, expect, it } from "vitest";
import { isAmuseLabsCrosswordFrame } from "./detect";

describe("isAmuseLabsCrosswordFrame", () => {
  it("accepts the CDN crossword frames (/pmm/crossword confirmed, customer-prefixed too)", () => {
    expect(
      isAmuseLabsCrosswordFrame(
        "https://cdn3.amuselabs.com/pmm/crossword?id=atlantic_20260711&set=atlantic",
      ),
    ).toBe(true);
    expect(
      isAmuseLabsCrosswordFrame(
        "https://cdn4.amuselabs.com/usatoday/crossword?id=x&set=usatoday",
      ),
    ).toBe(true);
    expect(
      isAmuseLabsCrosswordFrame("https://amuselabs.com/pmm/crossword"),
    ).toBe(true);
  });

  it("rejects non-crossword PuzzleMe paths (pickers, errors)", () => {
    expect(
      isAmuseLabsCrosswordFrame(
        "https://cdn3.amuselabs.com/pmm/date-picker?set=atlantic",
      ),
    ).toBe(false);
  });

  it("rejects other hosts, including lookalike suffixes", () => {
    expect(
      isAmuseLabsCrosswordFrame("https://amuselabs.com.evil.com/pmm/crossword"),
    ).toBe(false);
    expect(
      isAmuseLabsCrosswordFrame("https://notamuselabs.com/pmm/crossword"),
    ).toBe(false);
    expect(isAmuseLabsCrosswordFrame("https://example.com/pmm/crossword")).toBe(
      false,
    );
  });

  it("rejects non-https and non-URL input", () => {
    expect(
      isAmuseLabsCrosswordFrame("http://cdn3.amuselabs.com/pmm/crossword"),
    ).toBe(false);
    expect(isAmuseLabsCrosswordFrame("not a url")).toBe(false);
  });
});
