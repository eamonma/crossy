// Puzzle catalog routes (PROTOCOL.md §12, DESIGN.md §7). `POST /puzzles` ingests XWord Info JSON
// through the anti-corruption layer (ingest.ts) and returns the puzzle VIEW: typed `ClientPuzzle`,
// so the stored solution never appears in the response (INV-6, structural, not a runtime strip).
// A malformed or unacceptable puzzle returns one named rejection code; the code is chosen by the
// ACL's fixed check order, and the response body carries no solution content on any path. Full
// accounts only.
import { Hono } from "hono";
import { schema } from "@crossy/db";
import { toClientPuzzle } from "@crossy/protocol";
import type { ClientPuzzle } from "@crossy/protocol";
import type { AppDeps, ApiEnv } from "../context";
import { fail } from "../http/errors";
import { authMiddleware } from "../auth/middleware";
import { translateXwordInfo } from "./ingest";

/** The `POST /puzzles` response. `puzzle` is `ClientPuzzle`: no solution field, structurally. */
interface PuzzleView {
  readonly puzzleId: string;
  readonly puzzle: ClientPuzzle;
}

export function puzzleRoutes(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware(deps));

  app.post("/", async (c) => {
    const identity = c.get("identity");
    if (identity.isAnonymous) {
      return fail(
        c,
        "FULL_ACCOUNT_REQUIRED",
        "ingesting a puzzle requires a full account",
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, "VALIDATION", "request body must be JSON");
    }

    const parsed = translateXwordInfo(body);
    if (!parsed.ok) {
      // One named rejection with a stable code; the message never echoes solution content.
      return fail(c, parsed.code, parsed.message);
    }

    // Store the internal ServerPuzzle (solutions included) plus its detected features,
    // server-side only. The client view drops the solution by type (INV-6).
    const inserted = await deps.db
      .insert(schema.puzzles)
      .values({
        data: parsed.puzzle,
        features: parsed.features,
        source: { kind: "upload" },
      })
      .returning({ puzzleId: schema.puzzles.puzzleId });

    const view: PuzzleView = {
      puzzleId: inserted[0]!.puzzleId,
      puzzle: toClientPuzzle(parsed.puzzle),
    };
    return c.json(view, 201);
  });

  return app;
}
