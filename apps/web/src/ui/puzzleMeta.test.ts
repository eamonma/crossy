// The create screen's client-side metadata read. Not a validator (the server's ingestion ACL
// owns acceptance); these tests pin the read-only contract: real-export shapes yield a title
// and byline, absent-or-null fields read as absent, and only non-JSON-object input reads as
// unreadable. INV-6 posture: the reader touches no grid or answer fields.
import { describe, expect, it } from "vitest";
import { readPuzzleMeta } from "./puzzleMeta";

/** The shape a real NYT export carries (metadata fields only; grid content irrelevant here). */
const nytExport = {
  title: "New York Times, Friday, July 10, 2026",
  author: "Willa Angel Chen Miller",
  editor: "Will Shortz",
  date: "7/10/2026",
  dow: "Friday",
  size: { rows: 15, cols: 15 },
  clues: { across: ["1. A", "6. B"], down: ["1. C"] },
};

describe("readPuzzleMeta", () => {
  it("reads title, byline, day, geometry, and clue count from an export", () => {
    const meta = readPuzzleMeta(JSON.stringify(nytExport));
    expect(meta).toEqual({
      title: "New York Times, Friday, July 10, 2026",
      author: "Willa Angel Chen Miller",
      editor: "Will Shortz",
      date: "7/10/2026",
      dayOfWeek: "Friday",
      rows: 15,
      cols: 15,
      clueCount: 3,
    });
  });

  it("reads present-but-null metadata as absent, like ingestion's optional-field rule", () => {
    const meta = readPuzzleMeta(
      JSON.stringify({ title: null, author: null, size: { rows: 5, cols: 5 } }),
    );
    expect(meta).not.toBeNull();
    expect(meta?.title).toBeNull();
    expect(meta?.author).toBeNull();
    expect(meta?.rows).toBe(5);
  });

  it("decodes entities and trims, so the preview matches the stored title", () => {
    const meta = readPuzzleMeta(
      JSON.stringify({ title: "  Tom &amp; Jerry&#39;s  " }),
    );
    expect(meta?.title).toBe("Tom & Jerry's");
  });

  it("returns a meta of nulls for an object with no metadata (still a loadable puzzle)", () => {
    const meta = readPuzzleMeta("{}");
    expect(meta).toEqual({
      title: null,
      author: null,
      editor: null,
      date: null,
      dayOfWeek: null,
      rows: null,
      cols: null,
      clueCount: null,
    });
  });

  it("returns null only for non-JSON or non-object input", () => {
    expect(readPuzzleMeta("not json")).toBeNull();
    expect(readPuzzleMeta("[1,2]")).toBeNull();
    expect(readPuzzleMeta('"a string"')).toBeNull();
  });

  it("ignores malformed size and clues rather than failing the read", () => {
    const meta = readPuzzleMeta(
      JSON.stringify({ title: "T", size: "15x15", clues: { across: "nope" } }),
    );
    expect(meta?.title).toBe("T");
    expect(meta?.rows).toBeNull();
    expect(meta?.clueCount).toBeNull();
  });
});
