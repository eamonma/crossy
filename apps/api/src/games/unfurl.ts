// GET /g/{code}: the shareable invite link (PROTOCOL.md §12; DESIGN.md §7). The normative
// behavior is one row: public, an "HTML shell with OpenGraph tags for link unfurlers". Link
// unfurlers do not execute JavaScript, so the SPA cannot serve its own preview (DESIGN.md
// §7); this route answers unauthenticated (no auth middleware) with a static-copy shell. On
// iOS the same URL is a universal link: the AASA file claims `/g/*` (well-known/routes.ts),
// so the app intercepts it and this shell is the browser and unfurler fallback.
//
// INV-6 by construction: the response is built from nothing but the stored invite code. No
// puzzle content is read at all — not the snapshot, not the title or author (§12 pins those
// to GET /puzzles and GET /games only), not the game name, not membership. The endpoint is
// public and third-party-cached, so it MUST NOT expose board state (DESIGN.md §7); the
// OpenGraph copy is therefore generic. The code is resolved with the exact join-by-code
// normalization (INV-1, `findGameByInviteCode`), and the rendered code is the DB row's own
// value, CHECK-constrained to `^[2-9A-HJ-NP-Z]{8}$`, so it cannot carry markup and raw
// caller input is never echoed.
import { Hono } from "hono";
import type { AppDeps, ApiEnv } from "../context";
import { fail } from "../http/errors";
import { findGameByInviteCode } from "./lookup";

/**
 * The HTML shell. `code` is the stored invite code (safe alphabet by CHECK constraint).
 * OpenGraph carries static copy only; there is no og:image (the `/og/{gameId}` preview
 * renderer is DESIGN.md M7 polish, not §12) and no og:url (the public origin is not
 * configuration this route has, and §12 names none).
 */
function shell(code: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Crossy">
<meta property="og:title" content="You're invited to a crossword">
<meta property="og:description" content="Join the game on Crossy and solve it together.">
<title>Crossy invite</title>
</head>
<body>
<h1>You're invited to a crossword</h1>
<p>Open this link on a device with Crossy, or join with the code <strong>${code}</strong>.</p>
</body>
</html>
`;
}

export function unfurlRoutes(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/:code", async (c) => {
    const found = await findGameByInviteCode(deps.db, c.req.param("code"));
    if (found === null) {
      // §12 pins no rejection shape for this route, so the REST error envelope applies, and
      // the join-by-code reasoning transfers: the code is the lookup key, so there is no
      // game existence to protect (GAME_NOT_FOUND, 404). A malformed code lands here too:
      // it can match no stored code (CHECK constraint), so it is the same not-found.
      return fail(c, "GAME_NOT_FOUND", "no game with that code");
    }
    return c.html(shell(found.inviteCode));
  });

  return app;
}
