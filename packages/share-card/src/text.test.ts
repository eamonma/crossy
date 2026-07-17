// The text plumbing under the no-measurement rule (SHARE.md): budgets truncate by code
// point with one ellipsis, escaping is total, and the clock matches the app's stat rows.
import { describe, expect, it } from "vitest";
import { escapeXml, formatClock, truncate } from "./text";

describe("truncate (the grapheme budgets, SHARE.md layout contract)", () => {
  it("passes a string at or under budget through verbatim", () => {
    expect(truncate("Saturday Stumper", 30)).toBe("Saturday Stumper");
    expect(truncate("abc", 3)).toBe("abc");
  });

  it("cuts to budget-1 code points plus one ellipsis when over budget", () => {
    expect(truncate("abcdefgh", 5)).toBe("abcd…");
    expect(truncate("abcdefgh", 5).length).toBeLessThanOrEqual(5);
  });

  it("counts code points, never splitting an astral-plane character", () => {
    const s = "🐟🐟🐟🐟"; // four code points, eight UTF-16 units
    expect(truncate(s, 4)).toBe(s);
    expect(truncate(s + "x", 4)).toBe("🐟🐟🐟…");
  });
});

describe("escapeXml (every display string crosses it exactly once)", () => {
  it("escapes the five XML metacharacters", () => {
    expect(escapeXml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&apos;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeXml("Ada Lovelace")).toBe("Ada Lovelace");
  });
});

describe("formatClock (digit-for-digit the app's formatDuration/formatMSS)", () => {
  it("renders M:SS under an hour and H:MM:SS past it", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3661)).toBe("1:01:01");
  });

  it("never renders NaN or a negative clock", () => {
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(-5)).toBe("0:00");
  });
});
