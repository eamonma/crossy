// The SPA's path router, kept hand-rolled and small (no react-router): route parsing, link
// builders, and the one navigation primitive the screens share. Paths select the surface:
// `/` (home), `/puzzles` (the library, with `?play=<puzzleId>` as the extension's post-ingest
// play intent, D22), `/new` (create), `/game/<id>` (the live game, with
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

/** The parsed surface. `demo` is the dev-only fake-session board behind `?demo=1`. `party` on the
 * game route is the read-only projector screen (`/game/<id>?party=1`), opened on a TV; it is a
 * presentation flag on the same game, not a separate surface, so the game still loads normally.
 * `play` on the puzzles route is the extension's post-ingest play intent (D22): the library
 * puzzle to preselect for room creation, consumed once by the puzzles panel. */
export type Route =
  | { readonly kind: "home" }
  | { readonly kind: "puzzles"; readonly play?: string }
  | { readonly kind: "create" }
  | { readonly kind: "settings" }
  | { readonly kind: "game"; readonly gameId: string; readonly party?: boolean }
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

export function settingsHref(params: URLSearchParams): string {
  return `/settings${qs(preservedParams(params))}`;
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

/** The play intent (D22): `/puzzles?play=<puzzleId>`, the URL the extension opens after an
 * ingest. Constructible from a base origin plus the puzzle id alone; the puzzles panel consumes
 * it once (one explicit click creates the room, landing here never does). */
export function playHref(puzzleId: string, params: URLSearchParams): string {
  const p = preservedParams(params);
  p.set("play", puzzleId);
  return `/puzzles${qs(p)}`;
}

/** The projector link: the game URL plus `?party=1`, the read-only screen a host opens on a TV. */
export function partyHref(gameId: string, params: URLSearchParams): string {
  return gameHref(gameId, params, { party: "1" });
}

/** The same game link with the projector flag turned on or off, so a control can toggle party
 * mode without hand-editing the URL. `on` adds `?party=1` (identical to `partyHref`); `off`
 * drops it, landing back on the plain interactive game. Overrides survive either way. */
export function togglePartyHref(
  gameId: string,
  params: URLSearchParams,
  on: boolean,
): string {
  return on ? partyHref(gameId, params) : gameHref(gameId, params);
}

/** The game route with its projector flag read off `?party=1` (present on either the path or a
 * legacy query URL). `party` is only attached when set, so a plain game link stays `{ kind, gameId }`. */
function gameRoute(gameId: string, params: URLSearchParams): Route {
  return params.get("party") !== null
    ? { kind: "game", gameId, party: true }
    : { kind: "game", gameId };
}

/** The puzzles route with its play intent read off `?play=<puzzleId>` (the extension's
 * post-ingest landing, D22). Attached only when non-empty, so a plain library link stays
 * `{ kind: "puzzles" }`. */
function puzzlesRoute(params: URLSearchParams): Route {
  const play = params.get("play");
  return play !== null && play !== ""
    ? { kind: "puzzles", play }
    : { kind: "puzzles" };
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
    return gameRoute(legacyGame, params);
  }
  if (params.get("create") !== null) return { kind: "create" };
  if (params.get("puzzles") !== null) return puzzlesRoute(params);

  const segments = pathname.split("/").filter((s) => s !== "");
  if (segments[0] === "puzzles") return puzzlesRoute(params);
  if (segments[0] === "new") return { kind: "create" };
  if (segments[0] === "settings") return { kind: "settings" };
  if (segments[0] === "game" && segments[1] !== undefined) {
    return gameRoute(decodeURIComponent(segments[1]), params);
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
    // The projector flag survives the one-time redirect, so a legacy `?game=<id>&party=1` link
    // canonicalizes to `/game/<id>?party=1` and still opens the TV screen.
    if (params.get("party") !== null) extras["party"] = "1";
    return gameHref(game, params, extras);
  }
  if (params.get("create") !== null) return createHref(params);
  if (params.get("puzzles") !== null) {
    // The play intent survives the one-time redirect, so a legacy `?puzzles=1&play=<id>` link
    // still lands with its puzzle preselected.
    const play = params.get("play");
    return play !== null && play !== ""
      ? playHref(play, params)
      : puzzlesHref(params);
  }
  return null;
}
