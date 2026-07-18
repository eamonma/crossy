/**
 * Envelope dispatch unit vectors (PROTOCOL.md section 12; DESIGN.md section 7, D21; ROADMAP 6.1
 * x1). `dispatchIngest` is pure, so these run with no infrastructure. They pin the deterministic
 * form selection: legacy bare body byte-compatible with the pre-envelope contract, the
 * `{format, document}` envelope equivalent to it for `xwordinfo`, the two VALIDATION shapes, the
 * UNKNOWN_FORMAT rejection, and that no rejection message ever echoes document content (INV-6
 * discipline). The HTTP wiring, the stored `source.format`, and the response-level no-leak
 * backstop live in api.test.ts.
 *
 * Test names cite the invariant they defend so coverage is greppable.
 */
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { dispatchIngest } from "./dispatch";
import { translateXwordInfo } from "./ingest";

/** A planted marker that must never surface in any rejection message (INV-6 discipline). */
const MARKER = "MARKERWORD";

/** A well-formed 2x2 all-playable XWord Info document (the ingest.test.ts base). */
function xwordDoc(): Record<string, unknown> {
  return {
    size: { rows: 2, cols: 2 },
    grid: ["H", "I", "O", "N"],
    clues: {
      across: ["1. friendly opener", "3. keyboard basics"],
      down: ["1. up top", "2. and beside"],
    },
  };
}

/** A valid `.puz` file (a 1x2 all-playable row) as base64, built with real checksums. Small on
 * purpose: dispatch only needs one accepted puz to prove the registry route, the full parse is
 * pinned in puz.test.ts. */
function minimalPuz(): string {
  const cksum = (bytes: Buffer, seed = 0): number => {
    let sum = seed & 0xffff;
    for (const b of bytes) {
      sum = (sum >>> 1) | ((sum & 1) << 15);
      sum = (sum + b) & 0xffff;
    }
    return sum;
  };
  const grid = "AB"; // one across word, no down words
  const clues = ["1a"];
  const title = "";
  const author = "";
  const copyright = "";
  const solution = Buffer.from(grid, "latin1");
  const player = Buffer.from("--", "latin1");
  const stringBlock = Buffer.concat([
    Buffer.from("\0\0\0", "latin1"), // empty title, author, copyright
    Buffer.from("1a\0", "latin1"),
    Buffer.from("\0", "latin1"), // empty notepad
  ]);
  const textChecksum = (seed: number): number => {
    // title/author/copyright/notepad are all empty (contribute nothing); one clue, no NUL.
    return cksum(Buffer.from(clues[0]!, "latin1"), seed);
  };
  const header = Buffer.alloc(0x34);
  header.write("ACROSS&DOWN\0", 0x02, "latin1");
  header.write("1.3\0", 0x18, "latin1");
  header.writeUInt8(2, 0x2c); // width
  header.writeUInt8(1, 0x2d); // height
  header.writeUInt16LE(clues.length, 0x2e);
  const cib = cksum(header.subarray(0x2c, 0x34));
  header.writeUInt16LE(cib, 0x0e);
  let global = cksum(solution, cib);
  global = cksum(player, global);
  global = textChecksum(global);
  header.writeUInt16LE(global, 0x00);
  const partials = [cib, cksum(solution), cksum(player), textChecksum(0)];
  const mask = "ICHEATED";
  for (let i = 0; i < 4; i += 1) {
    header.writeUInt8((partials[i]! & 0xff) ^ mask.charCodeAt(i), 0x10 + i);
    header.writeUInt8(
      ((partials[i]! >> 8) & 0xff) ^ mask.charCodeAt(i + 4),
      0x14 + i,
    );
  }
  void title;
  void author;
  void copyright;
  return Buffer.concat([header, solution, player, stringBlock]).toString(
    "base64",
  );
}

/** Assert acceptance and narrow to the ok result. */
function accept(body: unknown) {
  const r = dispatchIngest(body);
  if (!r.ok) throw new Error(`expected accept, got ${r.code}: ${r.message}`);
  return r;
}

/** Assert exactly this rejection code; return the message for content checks. */
function expectReject(body: unknown, code: string): string {
  const r = dispatchIngest(body);
  expect(r.ok ? "ACCEPTED" : r.code).toBe(code);
  return r.ok ? "" : r.message;
}

describe("envelope dispatch: legacy bare body (PROTOCOL.md section 12)", () => {
  it("routes a bare XWord Info body to translateXwordInfo unchanged (byte-compatible legacy form)", () => {
    const direct = translateXwordInfo(xwordDoc());
    const dispatched = accept(xwordDoc());
    if (!direct.ok) throw new Error("fixture must translate");
    expect(dispatched.puzzle).toEqual(direct.puzzle);
    expect(dispatched.features).toEqual(direct.features);
    expect(dispatched.title).toBe(direct.title);
    expect(dispatched.author).toBe(direct.author);
    expect(dispatched.format).toBe("xwordinfo");
  });

  it("rejects a malformed bare body with the translator's own VALIDATION, unchanged", () => {
    const direct = translateXwordInfo({ rows: 2 });
    const message = expectReject({ rows: 2 }, "VALIDATION");
    if (direct.ok) throw new Error("fixture must reject");
    expect(message).toBe(direct.message);
  });

  it("treats a non-object body as the legacy form (the translator's VALIDATION, not a dispatch error)", () => {
    expect(expectReject(42, "VALIDATION")).toBe("puzzle must be a JSON object");
    expectReject(null, "VALIDATION");
    expectReject([1, 2], "VALIDATION");
  });

  it("treats an object with a document key but no format key as the legacy form", () => {
    // Dispatch keys on `format` alone (PROTOCOL.md section 12): without it, this is a bare
    // XWord Info document, which fails the translator's own structure checks.
    expectReject({ document: xwordDoc() }, "VALIDATION");
  });
});

describe("envelope dispatch: the {format, document} envelope (PROTOCOL.md section 12)", () => {
  it("translates an xwordinfo envelope identically to the bare body", () => {
    const bare = accept(xwordDoc());
    const enveloped = accept({ format: "xwordinfo", document: xwordDoc() });
    expect(enveloped.puzzle).toEqual(bare.puzzle);
    expect(enveloped.features).toEqual(bare.features);
    expect(enveloped.format).toBe("xwordinfo");
  });

  it("rejects format without document as VALIDATION", () => {
    expectReject({ format: "xwordinfo" }, "VALIDATION");
  });

  it("rejects a non-string format as VALIDATION", () => {
    expectReject({ format: 42, document: xwordDoc() }, "VALIDATION");
    expectReject({ format: null, document: xwordDoc() }, "VALIDATION");
    expectReject({ format: ["xwordinfo"], document: xwordDoc() }, "VALIDATION");
  });

  it("rejects an unknown format as UNKNOWN_FORMAT, naming the format", () => {
    const message = expectReject(
      { format: "nonesuch", document: "not parsed" },
      "UNKNOWN_FORMAT",
    );
    expect(message).toContain("nonesuch");
  });

  it("matches registry names exactly, never case-folded (stable identifiers, no INV-1 surface)", () => {
    // Registry names are never normalized or compared loosely, so no casing rule can diverge.
    expectReject(
      { format: "XWORDINFO", document: xwordDoc() },
      "UNKNOWN_FORMAT",
    );
  });

  it("never resolves a prototype-chain key as a format", () => {
    expectReject(
      { format: "constructor", document: xwordDoc() },
      "UNKNOWN_FORMAT",
    );
  });

  it("routes the puz format to translatePuz (its document is base64 file bytes, not JSON)", () => {
    // The puz translator takes a base64 STRING, so a non-string document is the translator's own
    // VALIDATION, not the envelope's UNKNOWN_FORMAT: this proves puz is registered and reached.
    const objectDoc = expectReject(
      { format: "puz", document: xwordDoc() },
      "VALIDATION",
    );
    expect(objectDoc).toContain("base64");
    // And a well-formed base64 puz file tags the accepted result with the puz format.
    const r = accept({ format: "puz", document: minimalPuz() });
    expect(r.format).toBe("puz");
  });
});

describe("envelope dispatch: rejection messages never echo the document (INV-6 discipline)", () => {
  it("UNKNOWN_FORMAT names the format and never the document (INV-6)", () => {
    const message = expectReject(
      { format: "nope", document: { grid: [MARKER], answer: MARKER } },
      "UNKNOWN_FORMAT",
    );
    expect(message).not.toContain(MARKER);
    expect(message).toContain("nope");
  });

  it("VALIDATION on a malformed envelope never echoes the body (INV-6)", () => {
    const nonString = expectReject(
      { format: 42, document: MARKER },
      "VALIDATION",
    );
    expect(nonString).not.toContain(MARKER);
    const noDocument = expectReject(
      { format: "xwordinfo", extra: MARKER },
      "VALIDATION",
    );
    expect(noDocument).not.toContain(MARKER);
  });

  it("translator rejections pass through without gaining document content (INV-6)", () => {
    const message = expectReject(
      {
        format: "xwordinfo",
        document: { ...xwordDoc(), grid: [MARKER + "TOOLONG", "I", "O", "N"] },
      },
      "REBUS_TOO_LONG",
    );
    expect(message).not.toContain(MARKER);
  });

  it("caps the echoed format name so an oversized format string cannot smuggle a document (INV-6)", () => {
    const huge = MARKER + "X".repeat(500);
    const message = expectReject(
      { format: huge, document: {} },
      "UNKNOWN_FORMAT",
    );
    expect(message.length).toBeLessThan(200);
  });
});
