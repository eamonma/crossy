// INV-1: casing and comparison are ASCII-only so the TypeScript and Swift ports cannot diverge.
// The Turkish dotted/dotless i is the canonical trap PROTOCOL.md §3 and §13 call out.
import { describe, expect, it } from "vitest";
import {
  VALUE_PATTERN,
  asciiUppercase,
  isValidValue,
  normalizeValue,
} from "./values";

describe("value normalization (PROTOCOL.md §3)", () => {
  it("INV-1: asciiUppercase maps a-z to A-Z and leaves every other code point unchanged", () => {
    expect(asciiUppercase("abc")).toBe("ABC");
    expect(asciiUppercase("aB9z")).toBe("AB9Z");
    expect(asciiUppercase("ABC123")).toBe("ABC123");
    // Non-ASCII letters are untouched: no locale uppercasing.
    expect(asciiUppercase("café")).toBe("CAFé");
    expect(asciiUppercase("naïve")).toBe("NAïVE");
  });

  it("INV-1: normalizeValue is ASCII uppercasing, never locale-aware", () => {
    // A locale-aware uppercasing of Turkish "i" would yield "İ" (U+0130); ASCII-only must not.
    expect(normalizeValue("istanbul")).toBe("ISTANBUL");
    expect(normalizeValue("istanbul")).not.toContain("İ");
  });

  it("INV-1: dotted (U+0130) and dotless (U+0131) i are left unchanged, so a Turkish client cannot diverge", () => {
    expect(asciiUppercase("İ")).toBe("İ");
    expect(asciiUppercase("ı")).toBe("ı");
  });
});

describe("value validity (PROTOCOL.md §11 INVALID_VALUE)", () => {
  it("VALUE_PATTERN is ^[A-Z0-9]{1,10}$ from PROTOCOL.md §3", () => {
    expect(VALUE_PATTERN.source).toBe("^[A-Z0-9]{1,10}$");
  });

  it("accepts normalized single letters, digits, and rebus strings up to 10", () => {
    for (const v of ["A", "a", "Z", "5", "AB", "abc", "A1B2", "ABCDEFGHIJ"]) {
      expect(isValidValue(v)).toBe(true);
    }
  });

  it("rejects the empty string, over-length rebus, and non-ASCII-uppercasable input", () => {
    for (const v of ["", "ABCDEFGHIJK", "A B", "A-B", "café"]) {
      expect(isValidValue(v)).toBe(false);
    }
  });

  it("INV-1: rejects U+0130 and U+0131 identically, since ASCII-only leaves them outside the charset", () => {
    expect(isValidValue("İ")).toBe(false);
    expect(isValidValue("ı")).toBe(false);
  });
});
