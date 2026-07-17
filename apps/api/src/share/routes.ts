// The public share surface (design/post-game/SHARE.md wave S2; PROTOCOL.md §12). Two unauthenticated
// routes behind one unguessable token:
//   GET /s/{token}           an HTML shell with OpenGraph tags, modeled on the invite unfurl
//                            (games/unfurl.ts): og:title from the puzzle title, og:image pointing at
//                            the card PNG with its dimensions, plus a minimal human page (the card,
//                            the title, a link to the app). Link unfurlers do not run JavaScript, so
//                            the SPA cannot serve its own preview (DESIGN.md §7); this static shell is
//                            the unfurler and browser fallback.
//   GET /s/{token}/card.png  the server-rasterized og card, built from the SAME letter-free analysis
//                            bundle and the SAME @crossy/share-card builder the web client uses.
//
// INV-6 by construction: the token resolves to a gameId, and the card is assembled from the analysis
// bundle (owners, counts) plus display metadata (names, title/author, date); no board letter is ever
// read (SHARE.md "No letters, ever"). Unknown, revoked, and malformed tokens all resolve to the SAME
// soft 404 shell, so the surface is no valid-vs-invalid oracle and never confirms token structure.
// Per-IP rate limiting mirrors the unfurl exactly (a plain-text 429), a flood cap in front of
// Cloudflare's edge rules, not a brute-force gate (the token space is 2^256).
//
// Wave 13.3 adds a replay loop to the shell; the human-page body is the clean seam for it.
import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@crossy/db";
import { escapeXml } from "@crossy/share-card";
import type { AppDeps, ApiEnv } from "../context";
import { clientIp, createRateLimiter } from "../http/rate-limit";
import { assembleShareCard } from "./cardData";
import { OG_HEIGHT, OG_WIDTH, renderShareCardPng } from "./render";
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

/** The share page: OpenGraph tags for unfurlers, and a minimal page for a human (the card, the
 * title, a link to the app). `title` is display content shown back verbatim, so it is XML-escaped;
 * `cardUrl` and `appOrigin` are config- and DB-derived, never raw caller input. */
function shareShell(args: {
  title: string;
  cardUrl: string;
  appOrigin: string;
}): string {
  const title = escapeXml(args.title);
  const cardUrl = escapeXml(args.cardUrl);
  const appOrigin = escapeXml(args.appOrigin);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Crossy">
<meta property="og:title" content="${title}">
<meta property="og:description" content="A finished crossword on Crossy.">
<meta property="og:image" content="${cardUrl}">
<meta property="og:image:width" content="${OG_WIDTH}">
<meta property="og:image:height" content="${OG_HEIGHT}">
<meta name="twitter:card" content="summary_large_image">
<title>${title} · Crossy</title>
</head>
<body>
<img src="${cardUrl}" width="${OG_WIDTH}" height="${OG_HEIGHT}" alt="${title}" style="max-width:100%;height:auto">
<h1>${title}</h1>
<p><a href="${appOrigin}">Open Crossy</a></p>
</body>
</html>
`;
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
    const gameId = await resolveActiveToken(deps, c.req.param("token"));
    if (gameId === null) return c.text("not found", 404);
    const data = await assembleShareCard(deps.db, gameId);
    if (data === null) return c.text("not found", 404);
    const png = renderShareCardPng(data);
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
    const data = await assembleShareCard(deps.db, gameId);
    if (data === null) {
      return c.html(notFoundShell(appOrigin), 404, {
        "cache-control": "no-store",
      });
    }
    // The absolute card URL sits on the same origin the shell was fetched from, so it works whether
    // this shell was served on the public share host or the core API host.
    const cardUrl = `${new URL(c.req.url).origin}/s/${c.req.param("token")}/card.png`;
    // og:title uses the card's own title, with the same fallbacks the card uses (puzzle title, then
    // the room name, then the board dims), so the unfurl headline and the card headline agree.
    const title = data.puzzle.title ?? "Crossy";
    return c.html(shareShell({ title, cardUrl, appOrigin }), 200, {
      "cache-control": SHELL_CACHE_CONTROL,
    });
  });

  return app;
}
