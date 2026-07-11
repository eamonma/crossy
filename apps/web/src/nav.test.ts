// The path router's contract: paths select surfaces, legacy query URLs keep working (old
// invite links are in the wild), and the dev/smoke overrides survive every link.
import { describe, expect, it } from "vitest";
import {
  canonicalHref,
  createHref,
  gameHref,
  homeHref,
  parseRoute,
  partyHref,
  preservedParams,
  puzzlesHref,
  settingsHref,
  togglePartyHref,
} from "./nav";

const p = (search: string): URLSearchParams => new URLSearchParams(search);

describe("parseRoute (paths select the surface)", () => {
  it("maps the path routes", () => {
    expect(parseRoute("/", p(""))).toEqual({ kind: "home" });
    expect(parseRoute("/puzzles", p(""))).toEqual({ kind: "puzzles" });
    expect(parseRoute("/new", p(""))).toEqual({ kind: "create" });
    expect(parseRoute("/settings", p(""))).toEqual({ kind: "settings" });
    expect(parseRoute("/game/g-1", p(""))).toEqual({
      kind: "game",
      gameId: "g-1",
    });
  });

  it("tolerates trailing slashes and falls back to home on unknown paths", () => {
    expect(parseRoute("/puzzles/", p(""))).toEqual({ kind: "puzzles" });
    expect(parseRoute("/game/g-1/", p(""))).toEqual({
      kind: "game",
      gameId: "g-1",
    });
    expect(parseRoute("/nope", p(""))).toEqual({ kind: "home" });
    expect(parseRoute("/game", p(""))).toEqual({ kind: "home" });
  });

  it("parses legacy query-routed URLs to the same surfaces (old links keep working)", () => {
    expect(parseRoute("/", p("?game=g-1&code=ABCD2345"))).toEqual({
      kind: "game",
      gameId: "g-1",
    });
    expect(parseRoute("/", p("?puzzles=1"))).toEqual({ kind: "puzzles" });
    expect(parseRoute("/", p("?create=1"))).toEqual({ kind: "create" });
    expect(parseRoute("/", p("?demo=1"))).toEqual({ kind: "demo" });
  });

  it("legacy query keys win over the path, so the first paint is right pre-canonicalization", () => {
    expect(parseRoute("/puzzles", p("?game=g-1"))).toEqual({
      kind: "game",
      gameId: "g-1",
    });
  });

  it("flags the projector screen from ?party=1 on the path or a legacy URL, and only then", () => {
    expect(parseRoute("/game/g-1", p("?party=1"))).toEqual({
      kind: "game",
      gameId: "g-1",
      party: true,
    });
    expect(parseRoute("/", p("?game=g-1&party=1"))).toEqual({
      kind: "game",
      gameId: "g-1",
      party: true,
    });
    // A plain game link carries no party key, so existing surfaces are untouched.
    expect(parseRoute("/game/g-1", p(""))).toEqual({
      kind: "game",
      gameId: "g-1",
    });
  });
});

describe("href builders (dev/smoke overrides survive every in-app link)", () => {
  const overrides = p("?api=http://a&ws=ws://s&token=T&code=SECRET99");

  it("preserves exactly api, ws, and token; never other params", () => {
    const kept = preservedParams(overrides);
    expect([...kept.keys()].sort()).toEqual(["api", "token", "ws"]);
    expect(kept.get("code")).toBeNull();
  });

  it("builds clean links for a real user (no overrides in the URL)", () => {
    expect(homeHref(p(""))).toBe("/");
    expect(puzzlesHref(p(""))).toBe("/puzzles");
    expect(createHref(p(""))).toBe("/new");
    expect(settingsHref(p(""))).toBe("/settings");
    expect(gameHref("g-1", p(""))).toBe("/game/g-1");
  });

  it("carries the dev/smoke overrides on the settings link", () => {
    const url = new URL(settingsHref(overrides), "http://x");
    expect(url.pathname).toBe("/settings");
    expect(url.searchParams.get("api")).toBe("http://a");
    expect(url.searchParams.get("ws")).toBe("ws://s");
    expect(url.searchParams.get("token")).toBe("T");
    expect(url.searchParams.get("code")).toBeNull();
  });

  it("carries the overrides and any extras on a game link", () => {
    const href = gameHref("g-1", overrides, { code: "ABCD2345" });
    const url = new URL(href, "http://x");
    expect(url.pathname).toBe("/game/g-1");
    expect(url.searchParams.get("api")).toBe("http://a");
    expect(url.searchParams.get("ws")).toBe("ws://s");
    expect(url.searchParams.get("token")).toBe("T");
    expect(url.searchParams.get("code")).toBe("ABCD2345");
  });

  it("builds the projector link as the game URL plus party=1", () => {
    const url = new URL(partyHref("g-1", overrides), "http://x");
    expect(url.pathname).toBe("/game/g-1");
    expect(url.searchParams.get("party")).toBe("1");
    expect(url.searchParams.get("token")).toBe("T");
    // Round-trips back to the projector route.
    expect(parseRoute(url.pathname, url.searchParams)).toEqual({
      kind: "game",
      gameId: "g-1",
      party: true,
    });
  });

  it("togglePartyHref adds ?party=1 when on, matching partyHref (a control enters party mode)", () => {
    expect(togglePartyHref("g-1", overrides, true)).toBe(
      partyHref("g-1", overrides),
    );
    const url = new URL(togglePartyHref("g-1", overrides, true), "http://x");
    expect(url.searchParams.get("party")).toBe("1");
    expect(url.searchParams.get("token")).toBe("T");
    // The projector route, so the toggle round-trips into party mode.
    expect(parseRoute(url.pathname, url.searchParams)).toEqual({
      kind: "game",
      gameId: "g-1",
      party: true,
    });
  });

  it("togglePartyHref drops the flag when off, landing on the plain game (the toggle leaves party mode)", () => {
    const url = new URL(togglePartyHref("g-1", overrides, false), "http://x");
    expect(url.pathname).toBe("/game/g-1");
    expect(url.searchParams.get("party")).toBeNull();
    expect(url.searchParams.get("token")).toBe("T");
    // Back to the interactive game route, no party flag.
    expect(parseRoute(url.pathname, url.searchParams)).toEqual({
      kind: "game",
      gameId: "g-1",
    });
  });
});

describe("canonicalHref (one-time redirect of legacy URLs to the path form)", () => {
  it("maps ?game= to /game/<id>, preserving the invite code, legacy name, and overrides", () => {
    const href = canonicalHref(
      "/",
      p("?game=g-1&code=ABCD2345&name=Sunday&api=http://a&token=T"),
    );
    expect(href).not.toBeNull();
    const url = new URL(href!, "http://x");
    expect(url.pathname).toBe("/game/g-1");
    expect(url.searchParams.get("code")).toBe("ABCD2345");
    expect(url.searchParams.get("name")).toBe("Sunday");
    expect(url.searchParams.get("api")).toBe("http://a");
    expect(url.searchParams.get("token")).toBe("T");
    expect(url.searchParams.get("game")).toBeNull();
  });

  it("maps ?puzzles=1 and ?create=1 to their paths", () => {
    expect(canonicalHref("/", p("?puzzles=1"))).toBe("/puzzles");
    expect(canonicalHref("/", p("?create=1"))).toBe("/new");
  });

  it("keeps the projector flag when canonicalizing a legacy ?game= link", () => {
    const href = canonicalHref("/", p("?game=g-1&code=ABCD2345&party=1"));
    const url = new URL(href!, "http://x");
    expect(url.pathname).toBe("/game/g-1");
    expect(url.searchParams.get("code")).toBe("ABCD2345");
    expect(url.searchParams.get("party")).toBe("1");
  });

  it("returns null for canonical locations and the demo surface", () => {
    expect(canonicalHref("/", p(""))).toBeNull();
    expect(canonicalHref("/game/g-1", p("?code=ABCD2345"))).toBeNull();
    expect(canonicalHref("/puzzles", p("?api=http://a"))).toBeNull();
    expect(canonicalHref("/", p("?demo=1"))).toBeNull();
  });
});
