// The kick caller (PROTOCOL.md section 12: DELETE /games/{id}/members/{userId}, host only). A
// stubbed fetch stands in for the network, so the behavior under test is only the request shape
// (method, path, bearer header) and how a status maps to the plain result the confirm dialog reads.
import { afterEach, describe, expect, it, vi } from "vitest";
import { kickMember } from "./rest";

const OPTS = {
  apiBase: "https://api.test",
  gameId: "g1",
  userId: "u2",
  token: "tok",
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("kickMember", () => {
  it("issues a bearer-authenticated DELETE to the member route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await kickMember(OPTS);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/games/g1/members/u2",
      {
        method: "DELETE",
        headers: { authorization: "Bearer tok" },
      },
    );
  });

  it("reads a 403 as the server saying no, plainly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
    );

    const result = await kickMember(OPTS);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      message: expect.stringContaining("server"),
    });
  });

  it("reads any other failure as a generic retry line, never a code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );

    const result = await kickMember(OPTS);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toMatch(/\d{3}|INTERNAL/);
  });
});
