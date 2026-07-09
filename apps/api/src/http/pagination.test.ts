// Unit tests for the shared list pagination helpers (GET /games, GET /puzzles). Pure, no
// container: they pin the clamp and cursor edges the route tests then exercise end to end.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parseBefore,
  parseLimit,
} from "./pagination";

describe("list pagination helpers (PROTOCOL.md §12 list endpoints)", () => {
  it("defaults an absent or empty limit to DEFAULT_LIMIT", () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(parseLimit("")).toBe(DEFAULT_LIMIT);
  });

  it("clamps a limit above the max down to MAX_LIMIT, so a client cannot over-ask", () => {
    expect(parseLimit("1000")).toBe(MAX_LIMIT);
    expect(parseLimit(String(MAX_LIMIT + 1))).toBe(MAX_LIMIT);
  });

  it("clamps a zero or negative limit up to 1", () => {
    expect(parseLimit("0")).toBe(1);
    expect(parseLimit("-5")).toBe(1);
  });

  it("floors a fractional limit and passes an in-range value through", () => {
    expect(parseLimit("2.9")).toBe(2);
    expect(parseLimit("25")).toBe(25);
  });

  it("defaults a non-numeric limit rather than erroring", () => {
    expect(parseLimit("abc")).toBe(DEFAULT_LIMIT);
  });

  it("treats an absent or empty before as the first page (no cursor)", () => {
    expect(parseBefore(undefined)).toEqual({ ok: true, before: null });
    expect(parseBefore("")).toEqual({ ok: true, before: null });
  });

  it("parses an ISO 8601 before into its Date", () => {
    const result = parseBefore("2026-01-02T03:04:05.000Z");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.before?.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    }
  });

  it("rejects an unparseable before, so the route maps it to VALIDATION", () => {
    expect(parseBefore("not-a-date")).toEqual({ ok: false });
  });
});
