// The public share surface (design/post-game/SHARE.md waves S2 + S3; PROTOCOL.md §12). Two
// unauthenticated routes behind one unguessable token:
//   GET /s/{token}           an HTML shell with OpenGraph tags, modeled on the invite unfurl
//                            (games/unfurl.ts): og:title from the puzzle title, og:image pointing at
//                            the card PNG with its dimensions, plus the human page whose hero is the
//                            replay loop (shell.ts): the mosaic drawing itself in solve order, pure
//                            CSS, static finished board under reduced motion. Link unfurlers do not
//                            run JavaScript or CSS, so the OpenGraph contract is untouched by the
//                            replay (DESIGN.md §7).
//   GET /s/{token}/card.png  the server-rasterized og card, built from the SAME letter-free analysis
//                            bundle and the SAME @crossy/share-card builder the web client uses.
//
// INV-6 by construction: the token resolves to a gameId, and both surfaces are assembled from the
// analysis bundle (owners, sequence cells + seconds) plus display metadata (names, title/author,
// date); no board letter is ever read (SHARE.md "No letters, ever"). Unknown, revoked, and malformed
// tokens all resolve to the SAME soft 404 shell, so the surface is no valid-vs-invalid oracle and
// never confirms token structure. Per-IP rate limiting mirrors the unfurl exactly (a plain-text
// 429), a flood cap in front of Cloudflare's edge rules, not a brute-force gate (the token space is
// 2^256).
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@crossy/db";
import { escapeXml } from "@crossy/share-card";
import type { AppDeps, ApiEnv } from "../context";
import { clientIp, createRateLimiter } from "../http/rate-limit";
import { assembleShareCard } from "./cardData";
import { renderShareCardPng } from "./render";
import { shareShell } from "./shell";
import { SHARE_TOKEN_PATTERN } from "./token";

/**
 * Per-IP rate limit for the public share routes (defense in depth; Cloudflare's edge rules are
 * primary). Unauthenticated and third-party-cached, so it is keyed by client IP; generous, a cap on
 * flood and the valid-vs-invalid oracle, not brute force (the token space is 2^256). The same shape
 * the invite unfurl uses.
 */
const SHARE_LIMIT_PER_WINDOW = 60;
const SHARE_WINDOW_MS = 60_000;

/** A completed game's card is immutable (INV-4), so its shell and PNG are safe to cache for a long
 * time at the edge and in the browser. `immutable` tells a client never to revalidate. */
const CARD_CACHE_CONTROL = "public, max-age=31536000, immutable";
/** The shell can gain a replay loop (wave 13.3) but its OpenGraph is stable per completed game; cache
 * it a shorter while so a shell change ships within the day, matching the invite shell's posture. */
const SHELL_CACHE_CONTROL = "public, max-age=3600";

/** The soft 404: a generic HTML page with no OpenGraph card and no hint of why the link is dead
 * (unknown, revoked, or malformed all land here), so the surface confirms nothing about the token.
 * Served at status 404 so a crawler treats it as not-found, never indexing a dead link. */
function notFoundShell(appOrigin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Crossy</title>
</head>
<body>
<h1>This share link isn't available</h1>
<p>The link may have been turned off, or it never existed. <a href="${escapeXml(appOrigin)}">Go to Crossy</a>.</p>
</body>
</html>
`;
}

/**
 * The card's two whitelisted shape params (PROTOCOL.md §12): `variant` (og | portrait) and `ground`
 * (light | dark), both defaulting to today's og/light so a bare `card.png` is byte-identical to the
 * pre-14.3 render (the og:image bytes never move). The native clients pass `variant=portrait` and,
 * on a dark device, `ground=dark`. The builder's `solo` variant is not exposed as a param: the route
 * derives it from the assembly's solo verdict, exactly as the web export does.
 */
const CARD_VARIANTS = new Set(["og", "portrait"]);
const CARD_GROUNDS = new Set(["light", "dark"]);

interface CardShape {
  readonly variant: "og" | "portrait";
  readonly ground: "light" | "dark";
}

/**
 * Parse the card's shape from the query string, whitelisting both params. An absent param takes its
 * default (og / light); any unrecognized value returns null so the route hands back the SAME soft
 * 404 an unknown/revoked/malformed token gets: no distinct 400 oracle, the surface confirms nothing
 * (including which param, or which value, was rejected).
 */
function parseCardShape(
  rawVariant: string | undefined,
  rawGround: string | undefined,
): CardShape | null {
  const variant = rawVariant ?? "og";
  const ground = rawGround ?? "light";
  if (!CARD_VARIANTS.has(variant) || !CARD_GROUNDS.has(ground)) return null;
  return { variant, ground } as CardShape;
}

/**
 * Resolve an ACTIVE (non-revoked) share token to its gameId. A malformed token is shape-rejected
 * before any DB probe (so garbage never touches the index), and a revoked one is filtered out in
 * SQL, so both return null exactly as an unknown token does: one soft 404, no oracle.
 */
async function resolveActiveToken(
  deps: AppDeps,
  token: string,
): Promise<string | null> {
  if (!SHARE_TOKEN_PATTERN.test(token)) return null;
  const rows = await deps.db
    .select({ gameId: schema.shareTokens.gameId })
    .from(schema.shareTokens)
    .where(
      and(
        eq(schema.shareTokens.token, token),
        isNull(schema.shareTokens.revokedAt),
      ),
    )
    .limit(1);
  return rows[0]?.gameId ?? null;
}

export function shareRoutes(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const limiter = createRateLimiter({
    limit: SHARE_LIMIT_PER_WINDOW,
    windowMs: SHARE_WINDOW_MS,
  });
  // The app origin a human is sent to: the configured web origin, else the request origin (which
  // also serves these routes). Never raw caller input.
  const appOriginOf = (reqUrl: string): string =>
    deps.webOrigin !== undefined && deps.webOrigin !== ""
      ? deps.webOrigin
      : new URL(reqUrl).origin;

  // The card PNG. Rasterized from the analysis bundle by the shared builder; long-cached (a
  // completed game's card never changes). Rate-limited like the shell.
  app.get("/:token/card.png", async (c) => {
    const gate = limiter.check(clientIp(c));
    if (!gate.ok) {
      return c.text("too many requests", 429, {
        "retry-after": String(gate.retryAfterSec),
      });
    }
    // Shape params are whitelisted before the DB probe: a bad value lands the SAME soft 404 as a
    // malformed token (garbage never touches the index, and the two are indistinguishable).
    const shape = parseCardShape(c.req.query("variant"), c.req.query("ground"));
    if (shape === null) return c.text("not found", 404);
    const gameId = await resolveActiveToken(deps, c.req.param("token"));
    if (gameId === null) return c.text("not found", 404);
    const assembly = await assembleShareCard(deps.db, gameId);
    if (assembly === null) return c.text("not found", 404);
    // A portrait request for a solo solve renders the builder's solo layout (the fill-order gold
    // ramp), matching the web export; og is never solo. The card is immutable for every shape, so
    // all combinations carry the same long-lived cache posture.
    const variant =
      shape.variant === "portrait" && assembly.solo ? "solo" : shape.variant;
    const png = renderShareCardPng(assembly.card, {
      ground: shape.ground,
      variant,
    });
    return c.body(png, 200, {
      "content-type": "image/png",
      "cache-control": CARD_CACHE_CONTROL,
    });
  });

  // The share page shell. OpenGraph for unfurlers, a minimal page for a human.
  app.get("/:token", async (c) => {
    const gate = limiter.check(clientIp(c));
    if (!gate.ok) {
      return c.text("too many requests", 429, {
        "retry-after": String(gate.retryAfterSec),
      });
    }
    const appOrigin = appOriginOf(c.req.url);
    const gameId = await resolveActiveToken(deps, c.req.param("token"));
    if (gameId === null) {
      return c.html(notFoundShell(appOrigin), 404, {
        "cache-control": "no-store",
      });
    }
    const assembly = await assembleShareCard(deps.db, gameId);
    if (assembly === null) {
      return c.html(notFoundShell(appOrigin), 404, {
        "cache-control": "no-store",
      });
    }
    // The absolute card URL sits on the same origin the shell was fetched from, so it works whether
    // this shell was served on the public share host or the core API host.
    const cardUrl = `${new URL(c.req.url).origin}/s/${c.req.param("token")}/card.png`;
    // og:title uses the card's own title, with the same fallbacks the card uses (puzzle title, then
    // the room name, then the board dims), so the unfurl headline and the card headline agree.
    const title = assembly.card.puzzle.title ?? "Crossy";
    return c.html(shareShell({ title, cardUrl, appOrigin, assembly }), 200, {
      "cache-control": SHELL_CACHE_CONTROL,
    });
  });

  return app;
}
