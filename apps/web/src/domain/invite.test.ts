// Share/invite fallback logic (ROADMAP Phase 4 stopgap retirement). The API value is preferred
// and the URL query param is the expand/contract fallback, so old invite links keep working.
import { describe, expect, it } from "vitest";
import { buildAppLink, buildShareUrl, resolveInviteField } from "./invite";

describe("resolveInviteField (URL param fallback for the API fields)", () => {
  it("prefers the API value when present", () => {
    expect(resolveInviteField("ABCD2345", "OLDLINK9")).toBe("ABCD2345");
    expect(resolveInviteField("From API", "from url")).toBe("From API");
  });

  it("falls back to the URL param when the API value is absent or empty (old links keep working)", () => {
    expect(resolveInviteField(undefined, "OLDLINK9")).toBe("OLDLINK9");
    expect(resolveInviteField(null, "OLDLINK9")).toBe("OLDLINK9");
    expect(resolveInviteField("", "OLDLINK9")).toBe("OLDLINK9");
  });

  it("returns null when neither the API nor the URL carries the field", () => {
    expect(resolveInviteField(undefined, null)).toBeNull();
    expect(resolveInviteField(null, null)).toBeNull();
    expect(resolveInviteField("", null)).toBeNull();
  });
});

describe("buildShareUrl (share popover no longer needs ?code= in the current URL)", () => {
  const base = { origin: "https://crossy.party", gameId: "g-1" };

  it("builds a joinable path-form link from the resolved code, independent of the current URL", () => {
    expect(buildShareUrl({ ...base, code: "ABCD2345", name: null })).toBe(
      "https://crossy.party/game/g-1?code=ABCD2345",
    );
  });

  it("appends the name for old-link continuity, URL-encoded", () => {
    expect(
      buildShareUrl({ ...base, code: "ABCD2345", name: "Sunday themeless" }),
    ).toBe(
      "https://crossy.party/game/g-1?code=ABCD2345&name=Sunday%20themeless",
    );
  });

  it("returns null when there is no code to share (popover shows its fallback message)", () => {
    expect(buildShareUrl({ ...base, code: null, name: "Named" })).toBeNull();
  });
});

describe("buildAppLink (crossy:// handoff for the signed-out iOS invite gate)", () => {
  it("mirrors the web link under the custom scheme so the app parser reads the code", () => {
    expect(buildAppLink({ gameId: "g-1", code: "ABCD2345", name: null })).toBe(
      "crossy://game/g-1?code=ABCD2345",
    );
  });

  it("appends the name, URL-encoded, exactly like the web link", () => {
    expect(
      buildAppLink({
        gameId: "g-1",
        code: "ABCD2345",
        name: "Sunday themeless",
      }),
    ).toBe("crossy://game/g-1?code=ABCD2345&name=Sunday%20themeless");
  });

  it("returns null when there is no code, so the gate offers no dead deep link", () => {
    expect(
      buildAppLink({ gameId: "g-1", code: null, name: "Named" }),
    ).toBeNull();
  });
});
