// The capture channel's pure pieces (capture.ts): the predicate the MAIN-world
// JSON.parse wrapper keys on, and the same-window message reader the ISOLATED
// content script trusts. Fixtures are synthetic, never real outlet content
// (DESIGN.md section 7).
import { describe, expect, it } from "vitest";
import {
  CAPTURED_DOC_TYPE,
  capturedDocMessage,
  looksLikePuzzleMeDocument,
  readCapturedDocMessage,
} from "./capture";
import { syntheticCapturedDoc } from "./fixtures";

describe("looksLikePuzzleMeDocument (the capture predicate, D21: fail closed)", () => {
  it("accepts the PuzzleMe puzzle document shape, extra fields ignored", () => {
    expect(looksLikePuzzleMeDocument(syntheticCapturedDoc())).toBe(true);
    expect(
      looksLikePuzzleMeDocument({
        ...syntheticCapturedDoc(),
        noise: true,
        cellInfos: [],
      }),
    ).toBe(true);
  });

  it("fails closed on non-objects: page JSON traffic passes through uncaptured", () => {
    for (const value of [null, undefined, 42, "rawc", true, [{ w: 1 }]]) {
      expect(looksLikePuzzleMeDocument(value)).toBe(false);
    }
  });

  it("fails closed when box or placedWords is missing or not an array", () => {
    const base = syntheticCapturedDoc();
    expect(looksLikePuzzleMeDocument({ ...base, box: undefined })).toBe(false);
    expect(looksLikePuzzleMeDocument({ ...base, box: "CY" })).toBe(false);
    expect(looksLikePuzzleMeDocument({ ...base, placedWords: undefined })).toBe(
      false,
    );
    expect(looksLikePuzzleMeDocument({ ...base, placedWords: {} })).toBe(false);
  });

  it("fails closed unless w and h are positive integers", () => {
    const base = syntheticCapturedDoc();
    expect(looksLikePuzzleMeDocument({ ...base, w: 0 })).toBe(false);
    expect(looksLikePuzzleMeDocument({ ...base, w: 2.5 })).toBe(false);
    expect(looksLikePuzzleMeDocument({ ...base, h: "1" })).toBe(false);
    expect(looksLikePuzzleMeDocument({ ...base, h: undefined })).toBe(false);
  });
});

describe("readCapturedDocMessage (same-window messaging: source and origin checked)", () => {
  const win = { self: true };
  const origin = "https://cdn3.amuselabs.com";
  const eventOf = (
    data: unknown,
    source: unknown = win,
    eventOrigin: string = origin,
  ) => ({ data, origin: eventOrigin, source });

  it("reads a well-formed captured-document message from this window and origin", () => {
    const doc = syntheticCapturedDoc();
    expect(
      readCapturedDocMessage(eventOf(capturedDocMessage(doc)), win, origin),
    ).toEqual(doc);
  });

  it("ignores a message whose source is not this window (never trust another frame)", () => {
    const message = capturedDocMessage(syntheticCapturedDoc());
    expect(
      readCapturedDocMessage(eventOf(message, { other: true }), win, origin),
    ).toBeNull();
    expect(
      readCapturedDocMessage(eventOf(message, null), win, origin),
    ).toBeNull();
  });

  it("ignores a message from another origin", () => {
    const message = capturedDocMessage(syntheticCapturedDoc());
    expect(
      readCapturedDocMessage(
        eventOf(message, win, "https://evil.example"),
        win,
        origin,
      ),
    ).toBeNull();
  });

  it("ignores other message types and re-checks the document shape on this side", () => {
    expect(
      readCapturedDocMessage(eventOf({ type: "other" }), win, origin),
    ).toBeNull();
    expect(readCapturedDocMessage(eventOf(null), win, origin)).toBeNull();
    expect(
      readCapturedDocMessage(eventOf(CAPTURED_DOC_TYPE), win, origin),
    ).toBeNull();
    expect(
      readCapturedDocMessage(
        eventOf({ type: CAPTURED_DOC_TYPE, document: { w: 1 } }),
        win,
        origin,
      ),
    ).toBeNull();
  });
});
