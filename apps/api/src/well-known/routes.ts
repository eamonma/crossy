// The `/.well-known` routes (apps/ios/ROADMAP.md SP-i4). Apple's app-site-association file
// binds the API host to the iOS app, so a shared `https://<api-host>/g/{code}` invite opens
// the app as a universal link (apps/ios/EXPERIENCE.md section 4). It lives on the API because
// the API is the normative home of `GET /g/{code}` (PROTOCOL.md section 12, DESIGN.md
// section 7) and Apple requires the AASA on the exact host the shared links point at. Apple's
// CDN fetches it unauthenticated and follows no redirect, so no auth middleware is installed
// and the file is answered directly at the exact path with Content-Type application/json.
//
// Fail closed: the app identifier is deploy-time configuration (`APPLE_APP_ID`), because the
// Apple app record and team are owner-held (apps/ios/ROADMAP.md) and do not exist yet. When it
// is unset the route is a plain 404, so an unconfigured deploy publishes no association rather
// than a broken one, and nothing is logged.
import { Hono } from "hono";
import type { AppDeps, ApiEnv } from "../context";

export function wellKnownRoutes(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();

  app.get("/apple-app-site-association", (c) => {
    const appId = deps.appleAppId;
    if (appId === undefined || appId === "") {
      return c.body(null, 404);
    }

    // The modern components format, scoped to invite links only: `/g/*` and nothing else, so
    // no other API path is ever claimed by the app. `webcredentials` (passkeys) is post-v1;
    // when it lands, it is added beside `applinks` here.
    const aasa = {
      applinks: {
        details: [{ appIDs: [appId], components: [{ "/": "/g/*" }] }],
      },
    };
    return c.body(JSON.stringify(aasa), 200, {
      "content-type": "application/json",
    });
  });

  return app;
}
