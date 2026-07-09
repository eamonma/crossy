// Identity module routes (DESIGN.md §8). This slice ships account deletion: the API-owned
// tombstone write paired with the vendor deleteUser call behind an injected port, plus host
// succession (DESIGN.md §7) for every game the caller hosts. PROTOCOL.md §12 lists no
// account-deletion route (flagged for the docs ledger); `DELETE /account` deletes the caller's
// own account, so the target is the authenticated identity and no elevation is possible.
import { Hono } from "hono";
import type { AppDeps, ApiEnv } from "../context";
import { authMiddleware } from "../auth/middleware";
import { deleteAccount } from "./deletion";

/** Build the identity routes bound to the app's ports. */
export function identityRoutes(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware(deps));

  // DELETE /account: delete the caller's own account (tombstone + vendor identity + succession).
  app.delete("/", async (c) => {
    const identity = c.get("identity");
    const result = await deleteAccount(deps, identity.userId);
    return c.json({
      userId: identity.userId,
      tombstoned: true,
      successions: result.successions,
      abandoned: result.abandoned,
      vendorDeleted: result.vendorDeleted,
    });
  });

  return app;
}
