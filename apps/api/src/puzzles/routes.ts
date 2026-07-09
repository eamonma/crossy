// Puzzle catalog routes (PROTOCOL.md §12, DESIGN.md §7). `POST /puzzles` ingests XWord Info JSON
// through the anti-corruption layer (ingest.ts) and returns the puzzle VIEW: typed `ClientPuzzle`,
// so the stored solution never appears in the response (INV-6, structural, not a runtime strip).
// A malformed or unacceptable puzzle returns one named rejection code; the code is chosen by the
// ACL's fixed check order, and the response body carries no solution content on any path. Full
// accounts only.
import { Hono } from "hono";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { schema } from "@crossy/db";
import { toClientPuzzle } from "@crossy/protocol";
import type { ClientPuzzle } from "@crossy/protocol";
import type { AppDeps, ApiEnv } from "../context";
import { fail } from "../http/errors";
import { parseBefore, parseLimit } from "../http/pagination";
import { authMiddleware } from "../auth/middleware";
import { translateXwordInfo } from "./ingest";

/** The `POST /puzzles` response. `puzzle` is `ClientPuzzle`: no solution field, structurally. */
interface PuzzleView {
  readonly puzzleId: string;
  readonly puzzle: ClientPuzzle;
}

/**
 * One row of `GET /puzzles`: a puzzle the caller uploaded, for the signed-in home list.
 *
 * INV-6: built from an explicit column list, never a select-all of the `puzzles` table (whose
 * `data` column holds the solution). Geometry (rows, cols) is projected out of `data` in SQL,
 * so the solution-bearing jsonb never enters the process. `features` is the detected-feature
 * flags (rebus, circles, ...), which carry no solution. `title`/`author` are the display metadata
 * ingestion parses, read from their own columns (never from `data`), null when the document
 * carried none; they are shown back verbatim and are not solutions (INV-6 untouched).
 */
interface PuzzleSummary {
  readonly puzzleId: string;
  readonly createdAt: string;
  readonly rows: number;
  readonly cols: number;
  readonly features: unknown;
  readonly title: string | null;
  readonly author: string | null;
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
    // server-side only. The client view drops the solution by type (INV-6). `createdBy`
    // records the uploader (the JIT-upserted caller) so `GET /puzzles` can list their own
    // uploads; it does not change this endpoint's response shape.
    const inserted = await deps.db
      .insert(schema.puzzles)
      .values({
        data: parsed.puzzle,
        features: parsed.features,
        source: { kind: "upload" },
        createdBy: identity.userId,
        // Display metadata parsed at the boundary; null when the document carried none. Stored
        // in dedicated columns, never in `data`, so no solution rides along (INV-6).
        title: parsed.title,
        author: parsed.author,
      })
      .returning({ puzzleId: schema.puzzles.puzzleId });

    const view: PuzzleView = {
      puzzleId: inserted[0]!.puzzleId,
      puzzle: toClientPuzzle(parsed.puzzle),
    };
    return c.json(view, 201);
  });

  // GET /puzzles: the caller's uploaded puzzles, newest first. Visibility is `created_by =
  // caller`, so a caller sees only their own uploads. Any authenticated caller may ask; a
  // guest never uploaded one (POST /puzzles is full-account-only), so their list is simply
  // empty, which needs no special case. Cursor pagination by `createdAt`.
  app.get("/", async (c) => {
    const identity = c.get("identity");

    const limit = parseLimit(c.req.query("limit"));
    const beforeResult = parseBefore(c.req.query("before"));
    if (!beforeResult.ok) {
      return fail(c, "VALIDATION", "before must be an ISO 8601 timestamp");
    }
    const before = beforeResult.before;

    // INV-6: an explicit column list, never a select-all. Geometry is projected out of `data`
    // in SQL (`->> 'rows'`/`'cols'`), so the solution-bearing jsonb never crosses into the
    // process; only `features` (no solution) is returned whole.
    const rows = await deps.db
      .select({
        puzzleId: schema.puzzles.puzzleId,
        createdAt: schema.puzzles.createdAt,
        features: schema.puzzles.features,
        title: schema.puzzles.title,
        author: schema.puzzles.author,
        puzzleRows: sql<number>`(${schema.puzzles.data} ->> 'rows')::int`,
        puzzleCols: sql<number>`(${schema.puzzles.data} ->> 'cols')::int`,
      })
      .from(schema.puzzles)
      .where(
        and(
          eq(schema.puzzles.createdBy, identity.userId),
          before === null ? undefined : lt(schema.puzzles.createdAt, before),
        ),
      )
      .orderBy(desc(schema.puzzles.createdAt), desc(schema.puzzles.puzzleId))
      .limit(limit);

    const puzzles: PuzzleSummary[] = rows.map((r) => ({
      puzzleId: r.puzzleId,
      createdAt: r.createdAt.toISOString(),
      rows: r.puzzleRows,
      cols: r.puzzleCols,
      features: r.features,
      title: r.title,
      author: r.author,
    }));
    return c.json({ puzzles });
  });

  return app;
}
