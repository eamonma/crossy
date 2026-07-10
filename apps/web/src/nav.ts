// The SPA's path router, kept hand-rolled and small (no react-router): route parsing, link
// builders, and the one navigation primitive the screens share. Paths select the surface:
// `/` (home), `/puzzles` (the library), `/new` (create), `/game/<id>` (the live game, with
// `?code=` riding along on invite links). Old query-routed URLs (`?game=`, `?puzzles=1`,
// `?create=1`) still parse to the same routes and are canonicalized once via replaceState
// (`canonicalHref`), so invite links in the wild keep working. The dev/smoke overrides
// (`?api=`, `?ws=`, `?token=`) stay query params and are carried across every in-app link.
//
// This module stays in its own file so screen components can depend on the types and builders
// without importing App (which imports them), keeping the dependency graph acyclic (the
// boundary lint forbids cycles).

/** Push a new location (path plus optional query), e.g. `/game/abc?code=X`. */
export type Navigate = (to: string) => void;

/** The parsed surface. `demo` is the dev-only fake-session board behind `?demo=1`. */
export type Route =
  | { readonly kind: "home" }
  | { readonly kind: "puzzles" }
  | { readonly kind: "create" }
  | { readonly kind: "game"; readonly gameId: string }
  | { readonly kind: "demo" };

/** The dogfood/dev override params carried across every in-app link. */
const PRESERVED = ["api", "ws", "token"] as const;

/** Carry only the dev/smoke overrides (api, ws, token) across an in-app link. */
export function preservedParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams();
  for (const key of PRESERVED) {
    const value = params.get(key);
    if (value !== null) next.set(key, value);
  }
  return next;
}

function qs(p: URLSearchParams): string {
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

export function homeHref(params: URLSearchParams): string {
  return `/${qs(preservedParams(params))}`;
}

export function puzzlesHref(params: URLSearchParams): string {
  return `/puzzles${qs(preservedParams(params))}`;
}

export function createHref(params: URLSearchParams): string {
  return `/new${qs(preservedParams(params))}`;
}

/** A game link: overrides survive, and extras (the invite `code`) ride the query string. */
export function gameHref(
  gameId: string,
  params: URLSearchParams,
  extras?: Record<string, string>,
): string {
  const p = preservedParams(params);
  if (extras !== undefined) {
    for (const [k, v] of Object.entries(extras)) p.set(k, v);
  }
  return `/game/${encodeURIComponent(gameId)}${qs(p)}`;
}

/**
 * Parse a location into a Route. Legacy query keys win over the path so an old-style URL
 * renders the right surface on the very first paint, before `canonicalHref` cleans the
 * address bar; an unknown path falls back to home rather than a dead end.
 */
export function parseRoute(pathname: string, params: URLSearchParams): Route {
  if (params.get("demo") !== null) return { kind: "demo" };
  const legacyGame = params.get("game");
  if (legacyGame !== null && legacyGame !== "") {
    return { kind: "game", gameId: legacyGame };
  }
  if (params.get("create") !== null) return { kind: "create" };
  if (params.get("puzzles") !== null) return { kind: "puzzles" };

  const segments = pathname.split("/").filter((s) => s !== "");
  if (segments[0] === "puzzles") return { kind: "puzzles" };
  if (segments[0] === "new") return { kind: "create" };
  if (segments[0] === "game" && segments[1] !== undefined) {
    return { kind: "game", gameId: decodeURIComponent(segments[1]) };
  }
  return { kind: "home" };
}

/**
 * The canonical path form for a legacy query-routed location, or null when the location is
 * already canonical. `?game=<id>&code=...` maps to `/game/<id>?code=...` (the code is the
 * join capability and must survive; a legacy `?name=` rides along for pre-API-name links).
 * `?demo=1` is a dev surface and deliberately keeps its query form.
 */
export function canonicalHref(
  pathname: string,
  params: URLSearchParams,
): string | null {
  void pathname;
  if (params.get("demo") !== null) return null;
  const game = params.get("game");
  if (game !== null && game !== "") {
    const extras: Record<string, string> = {};
    const code = params.get("code");
    const name = params.get("name");
    if (code !== null) extras["code"] = code;
    if (name !== null) extras["name"] = name;
    return gameHref(game, params, extras);
  }
  if (params.get("create") !== null) return createHref(params);
  if (params.get("puzzles") !== null) return puzzlesHref(params);
  return null;
}
