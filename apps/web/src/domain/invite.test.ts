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

describe("buildShareUrl (the short crossy.ing/<code> invite link)", () => {
  it("builds the short link from the resolved code alone", () => {
    expect(buildShareUrl({ code: "ABCD2345" })).toBe(
      "https://crossy.ing/ABCD2345",
    );
  });

  it("carries only the code: no gameId, no name, no query string", () => {
    const url = buildShareUrl({ code: "ABCD2345" });
    expect(url).toBe("https://crossy.ing/ABCD2345");
    expect(url).not.toContain("name");
    expect(url).not.toContain("game");
    expect(url).not.toContain("?");
  });

  it("returns null when there is no code to share (popover shows its fallback message)", () => {
    expect(buildShareUrl({ code: null })).toBeNull();
  });
});

describe("buildAppLink (crossy:// handoff for the signed-out iOS invite gate)", () => {
  it("mirrors the web link under the custom scheme so the app parser reads the code", () => {
    expect(buildAppLink({ gameId: "g-1", code: "ABCD2345" })).toBe(
      "crossy://game/g-1?code=ABCD2345",
    );
  });

  it("returns null when there is no code, so the gate offers no dead deep link", () => {
    expect(buildAppLink({ gameId: "g-1", code: null })).toBeNull();
  });
});
