// The invite host (PROTOCOL.md §12 "Invite links"). A dedicated public host (e.g. crossy.ing)
// that serves the SHORT share link `{invite-host}/{code}` and nothing else. It is host-scoped:
// this middleware owns a request only when the request hostname matches `deps.inviteHost`, and
// otherwise falls straight through to the core API (rest.crossy.party), so the short-link surface
// and the REST API never collide even though both are served by this one process.
//
// Two endpoints, both public and unauthenticated:
//   GET /.well-known/apple-app-site-association  the AASA claiming the whole host (`/*`) for the
//     iOS app, so an installed app opens `{invite-host}/{code}` directly as a universal link.
//   GET /{code}  the smart expander. It resolves the code to a game and serves two audiences from
//     one URL: a real browser navigation (Sec-Fetch-Mode: navigate) gets a `302` to the canonical
//     game view `{web-origin}/game/{gameId}?code={code}`, where the existing gate + join flow take
//     over; a link unfurler (no navigate signal) gets a `200` OpenGraph shell that ALSO
//     meta-refreshes a misclassified browser onward, so a human always lands in the game and a bot
//     always reads the OG card (a plain `302` would hand the unfurler the destination's card, not
//     ours).
//
// INV-6 / DESIGN.md §7: the code is shape-gated against the CHECK alphabet BEFORE any DB lookup,
// so garbage never probes the index; a malformed or unknown code is bounced to the web home, never
// an oracle 404; and no board state or solution is ever read or rendered here. The host is read
// from the request URL (`new URL(c.req.url).hostname`), which @hono/node-server builds from the
// incoming Host header in production and a test sets by passing an absolute URL; the `Host` header
// itself is a forbidden header the Fetch layer will not let a test set.
import type { Context, MiddlewareHandler } from "hono";
import type { AppDeps, ApiEnv } from "../context";
import { INVITE_CODE_PATTERN } from "../games/invite-code";
import { findGameByInviteCode, normalizeInviteCode } from "../games/lookup";

const AASA_PATH = "/.well-known/apple-app-site-association";

/**
 * The invite host's app-site-association. It claims the whole host (`components: [{ "/": "/*" }]`)
 * because every path on the invite host is an invite link, so an installed app intercepts
 * `{invite-host}/{code}` as a universal link. Fail closed with 404 when no app identifier is
 * configured, exactly as the core AASA does: an unconfigured deploy publishes no association
 * rather than a broken one. Apple's CDN fetches this anonymously and follows no redirect, so it is
 * answered directly with Content-Type application/json.
 */
function serveAasa(
  c: Context<ApiEnv>,
  appleAppId: string | undefined,
): Response {
  if (appleAppId === undefined || appleAppId === "") return c.body(null, 404);
  const aasa = {
    applinks: {
      details: [{ appIDs: [appleAppId], components: [{ "/": "/*" }] }],
    },
  };
  return c.body(JSON.stringify(aasa), 200, {
    "content-type": "application/json",
  });
}

/**
 * The OpenGraph shell served to a link unfurler (and any request without a browser-navigation
 * signal). Generic copy only, never board state or a solution (INV-6, DESIGN.md §7); there is no
 * og:image yet (the `/og/{gameId}` renderer is later polish). It also forwards a real browser that
 * reached this path without a navigate signal: the meta refresh and the script both replace the
 * location with the game URL, and the visible link is the no-JS fallback, so a human never dead-ends
 * on this page. `shortUrl` and `gameUrl` are built from config, a DB-sourced UUID, and a
 * CHECK-constrained code, none of them raw caller input, so interpolation carries no markup.
 */
function inviteShell(shortUrl: string, gameUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Crossy">
<meta property="og:title" content="You're invited to a crossword">
<meta property="og:description" content="Join the game on Crossy and solve it together.">
<meta property="og:url" content="${shortUrl}">
<meta http-equiv="refresh" content="0; url=${gameUrl}">
<title>Crossy invite</title>
</head>
<body>
<p>Opening the game… <a href="${gameUrl}">Continue to Crossy</a>.</p>
<script>location.replace(${JSON.stringify(gameUrl)})</script>
</body>
</html>
`;
}

/**
 * Host-scoped middleware for the invite host. Returns a pass-through no-op unless BOTH `inviteHost`
 * and `webOrigin` are configured: a half-configured deploy (a host with nothing to redirect to)
 * fails safe by staying disabled rather than 302-ing to an empty target. When enabled, it inspects
 * the request hostname and either owns the request (invite host) or forwards it to the core API
 * (any other host).
 */
export function inviteHostMiddleware(deps: AppDeps): MiddlewareHandler<ApiEnv> {
  const inviteHost = deps.inviteHost?.toLowerCase();
  const webOrigin = deps.webOrigin;
  if (
    inviteHost === undefined ||
    inviteHost === "" ||
    webOrigin === undefined ||
    webOrigin === ""
  ) {
    return async (_c, next) => {
      await next();
    };
  }

  const home = `${webOrigin}/`;
  return async (c, next) => {
    const host = new URL(c.req.url).hostname.toLowerCase();
    if (host !== inviteHost) return next();

    // From here down this request is on the invite host and this middleware answers it end to end;
    // it never falls through to the core routes (nor to CORS, which invite navigations do not need).
    if (c.req.method !== "GET") return c.redirect(home, 302);

    const path = c.req.path;
    if (path === AASA_PATH) return serveAasa(c, deps.appleAppId);

    // Exactly one path segment is the code. The root, or any deeper path, carries no code: bounce
    // to the web home.
    const segment = path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (segment === "" || segment.includes("/")) return c.redirect(home, 302);

    const code = normalizeInviteCode(decodeURIComponent(segment));
    // Shape-gate before any DB touch: a code that cannot be a real code never probes the index.
    if (!INVITE_CODE_PATTERN.test(code)) return c.redirect(home, 302);

    const found = await findGameByInviteCode(deps.db, code);
    // Unknown code bounces to the web home, not a 404: the code is the lookup key, so there is no
    // game existence to protect, and a home redirect gives no valid-vs-invalid oracle a 404 would.
    if (found === null) return c.redirect(home, 302);

    const shortUrl = `https://${inviteHost}/${found.inviteCode}`;
    const gameUrl = `${webOrigin}/game/${encodeURIComponent(found.gameId)}?code=${found.inviteCode}`;

    // A real browser navigation gets a clean 302 straight into the game. Everything else (a link
    // unfurler, curl, an old browser) gets the OG shell, which also forwards a browser onward.
    if (c.req.header("sec-fetch-mode") === "navigate") {
      return c.redirect(gameUrl, 302);
    }
    return c.html(inviteShell(shortUrl, gameUrl), 200, {
      "cache-control": "public, max-age=300",
    });
  };
}
