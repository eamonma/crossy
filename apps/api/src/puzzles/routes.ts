// Puzzle catalog routes (PROTOCOL.md §12, DESIGN.md §7). `POST /puzzles` ingests a puzzle
// document, either the legacy bare XWord Info body or the `{format, document}` envelope, through
// the anti-corruption layer (dispatch.ts picks the translator) and returns the puzzle VIEW: typed
// `ClientPuzzle`, so the stored solution never appears in the response (INV-6, structural, not a
// runtime strip). A malformed or unacceptable puzzle returns one named rejection code; the code
// is chosen by the dispatch rules and the ACL's fixed check order, and the response body carries
// no solution or document content on any path. Full accounts only.
import { Hono } from "hono";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { schema } from "@crossy/db";
import { deriveMask, toClientPuzzle } from "@crossy/protocol";
import type { ClientPuzzle, Mask } from "@crossy/protocol";
import type { AppDeps, ApiEnv } from "../context";
import { fail } from "../http/errors";
import { parseBefore, parseLimit } from "../http/pagination";
import { authMiddleware } from "../auth/middleware";
import { dispatchIngest } from "./dispatch";

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
 *
 * `mask` is the black-square silhouette (PROTOCOL.md §12): an array of row strings of `#` and `.`,
 * derived from the puzzle's block indices, the one other pattern-only field projected out of
 * `data` (`data -> 'blocks'`, a jsonb array of integers). It carries the pattern and nothing else:
 * no letters, no numbering, no solution (INV-6 untouched). Only geometry and blocks cross into the
 * process; the solution-bearing `data` is never selected whole.
 */
interface PuzzleSummary {
  readonly puzzleId: string;
  readonly createdAt: string;
  readonly rows: number;
  readonly cols: number;
  readonly features: unknown;
  readonly title: string | null;
  readonly author: string | null;
  readonly mask: Mask;
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

    const parsed = dispatchIngest(body);
    if (!parsed.ok) {
      // One named rejection with a stable code; the message never echoes solution or
      // document content (INV-6 discipline, PROTOCOL.md §12).
      return fail(c, parsed.code, parsed.message);
    }

    // Store the internal ServerPuzzle (solutions included) plus its detected features,
    // server-side only. The client view drops the solution by type (INV-6). `createdBy`
    // records the uploader (the JIT-upserted caller) so `GET /puzzles` can list their own
    // uploads; it does not change this endpoint's response shape. `source.format` records
    // the registry format on every ingest path, legacy included (DESIGN.md §7: a debugging
    // fact, not behavior).
    const inserted = await deps.db
      .insert(schema.puzzles)
      .values({
        data: parsed.puzzle,
        features: parsed.features,
        source: { kind: "upload", format: parsed.format },
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
    // process; only `features` (no solution) is returned whole. `blocks` is the other pattern-only
    // field the mask needs: `data -> 'blocks'` is a jsonb array of integer cell indices, no
    // solution, projected the same way. The mask itself is derived below (deriveMask); the
    // solution never enters this query.
    const rows = await deps.db
      .select({
        puzzleId: schema.puzzles.puzzleId,
        createdAt: schema.puzzles.createdAt,
        features: schema.puzzles.features,
        title: schema.puzzles.title,
        author: schema.puzzles.author,
        puzzleRows: sql<number>`(${schema.puzzles.data} ->> 'rows')::int`,
        puzzleCols: sql<number>`(${schema.puzzles.data} ->> 'cols')::int`,
        blocks: sql<number[]>`${schema.puzzles.data} -> 'blocks'`,
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
      // The pattern-only silhouette, derived from geometry and block indices (PROTOCOL.md §12).
      mask: deriveMask({
        rows: r.puzzleRows,
        cols: r.puzzleCols,
        blocks: r.blocks ?? [],
      }),
    }));
    return c.json({ puzzles });
  });

  return app;
}
