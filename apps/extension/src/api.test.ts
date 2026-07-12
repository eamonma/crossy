// postPuzzle outcome mapping (PROTOCOL.md section 12; dedup D23). The global fetch is stubbed,
// so this exercises the status-to-outcome logic with no network. The load-bearing case is the
// 200 duplicate: the extension re-posts today's puzzle on every visit, so a re-post must resolve
// to success on the existing row exactly like a fresh 201, ignoring the `duplicate` marker.
import { afterEach, describe, expect, it, vi } from "vitest";
import { postPuzzle } from "./api";
import type { Envelope } from "./envelope";

const ENVELOPE: Envelope = { format: "guardian", document: {} };

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(body), { status })),
    ),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("postPuzzle (PROTOCOL.md section 12; dedup D23)", () => {
  it("treats a 201 fresh insert as success, keyed on puzzleId", async () => {
    mockFetch(201, { puzzleId: "p-1", puzzle: { rows: 3 } });
    const out = await postPuzzle("https://api.test", "tok", ENVELOPE);
    expect(out).toEqual({ ok: true, puzzleId: "p-1" });
  });

  it("treats a 200 duplicate as success identically, ignoring the marker (D23)", async () => {
    mockFetch(200, {
      puzzleId: "p-existing",
      puzzle: { rows: 3 },
      duplicate: true,
    });
    const out = await postPuzzle("https://api.test", "tok", ENVELOPE);
    expect(out).toEqual({ ok: true, puzzleId: "p-existing" });
  });

  it("surfaces a named rejection verbatim (INV-6: code and message only)", async () => {
    mockFetch(422, { error: "REBUS_TOO_LONG", message: "cell too long" });
    const out = await postPuzzle("https://api.test", "tok", ENVELOPE);
    expect(out).toEqual({
      ok: false,
      code: "REBUS_TOO_LONG",
      message: "cell too long",
    });
  });

  it("falls back to a status-coded failure on an unexpected response", async () => {
    mockFetch(500, {});
    const out = await postPuzzle("https://api.test", "tok", ENVELOPE);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("HTTP_500");
  });
});
