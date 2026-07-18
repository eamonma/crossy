// The share card's server-side data assembly (design/post-game/SHARE.md wave S2): everything
// between the analysis bundle and @crossy/share-card's pure builder, computed on the server so the
// OpenGraph card can render without a browser. It is the server twin of apps/web/src/share/
// shareCardData.ts; apps never import apps (DESIGN.md layering), so the two are deliberate twins
// that assemble the SAME ShareCardData shape from the SAME analysis bundle for the SAME builder.
//
// It reuses the API's existing analysis computation path verbatim (`gameAnalysis`, the Archive read
// model) rather than forking it: owners, the replay sequence, the titles' presence (for the solo
// rule), the active-time stats. It adds only display metadata: the puzzle title/author off the
// joined puzzles row (named columns, never the solution-bearing `data`), the members' display names
// off the users mirror, and each member's wire color through the shared identity roster so the card
// wears the exact hex the clients paint.
//
// INV-6, by construction: the only puzzle facts that enter are the block silhouette and grid dims,
// projected out of `puzzle_snapshot` in SQL (`-> 'blocks'`, `->> 'rows'`/`'cols'`) exactly as the
// game view does, so the solution-bearing jsonb never enters the process. Everything else is
// owners, counts, names, and title/author display strings. Nothing letter-shaped is accepted, so
// none can render (SHARE.md "No letters, ever").
//
// Title copy: the og card renders each titled solver's credit, the film-credit LABEL for their
// title key ("The saboteur") beside their color chip and name. The label is shared normative ground
// (vectors/analysis/title-labels.json, pinned by titleLabels.ts, the same vector the web/iOS/Android
// surfaces pin against), so the server card does not fork a string. LABELS ONLY: the evidence/detail
// line under a label interpolates the solve's stats and stays client-owned, and the og variant
// compresses credits to titles only anyway (packages/share-card), so the server sets `label` and no
// `detail`. The bundle's titles are still read for the solo rule (fewer than two writers -> the
// fill-order ramp, no credits), matching the web.
import { eq, sql } from "drizzle-orm";
import { schema } from "@crossy/db";
import { assignRoomColors } from "@crossy/protocol";
import type { ShareCardData, ShareCardSolver } from "@crossy/share-card";
import type { Db } from "../db/client";
import { gameAnalysis } from "../archive/analysis";
import { identityColor } from "./identityRoster";
import { titleLabelOf } from "./titleLabels";

/** The §4 tombstone fallback: a member whose mirror row holds no display name. Matches the
 * FORMER_PARTICIPANT string the game view and the session participant payload send. */
const FORMER_PARTICIPANT = "former participant";

/** A solver the membership no longer knows (a departed member who still owns squares): the neutral
 * treatment, one fixed hex per ground, byte-identical to the web assembly's DEPARTED. */
const DEPARTED = {
  name: "A solver",
  light: "#8C8880",
  dark: "#75717B",
} as const;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** "Jul 17, 2026" in UTC with fixed English month names: a display string, never compared, so INV-1
 * casing is untouched, and stable regardless of the server's locale or zone. */
export function formatShareDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]!} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** The fill-order map for the solo mosaic: the replay sequence (ascending by (at, seq)) mapped to
 * [0, 1] by rank. Byte-identical to the web assembly's fillOrderOf. */
function fillOrderOf(
  sequence: readonly { cell: number; atSeconds: number }[],
): Record<number, number> {
  const out: Record<number, number> = {};
  const n = sequence.length;
  sequence.forEach((entry, i) => {
    out[entry.cell] = n > 1 ? i / (n - 1) : 0;
  });
  return out;
}

/** Everything the public share surface renders from: the card's data for the builder, plus the
 * bundle's replay sequence verbatim (cells + active seconds, ascending; INV-6 letter-free by shape)
 * for the shell's replay loop, and the solo verdict so the shell paints the same mosaic the card
 * paints (owners wash, or the fill-order gold ramp). */
export interface ShareAssembly {
  readonly card: ShareCardData;
  readonly sequence: readonly { cell: number; atSeconds: number }[];
  readonly solo: boolean;
}

/**
 * Assemble the completion share surface's data for a game, on read. Returns null when the game does
 * not exist or is not completed (the same gate the analysis endpoint applies), so the public routes
 * surface a soft 404 rather than compute anything. A completed game is immutable (INV-4), so this is
 * stable: the same inputs yield the same card and the same replay, which is why both are safely
 * cached.
 *
 * The unfurl always rasterizes the og variant (1200x630, light ground; SHARE.md S2) from `card`;
 * `fillOrderByCell` is still populated for a solo solve (the og variant ignores it, but it keeps the
 * shape faithful to the portrait/solo consumers). `sequence` feeds the shell's replay loop (wave
 * 13.3), the same rows the analysis endpoint serves.
 */
export async function assembleShareCard(
  db: Db,
  gameId: string,
): Promise<ShareAssembly | null> {
  // Completion gate + geometry + masthead in one read. Geometry is projected out of the snapshot in
  // SQL so the solution-bearing jsonb never enters the process (INV-6), the game view's pattern.
  // The puzzle title/author come from the joined puzzles row (named columns, never `data`).
  const rows = await db
    .select({
      completedAt: schema.gameState.completedAt,
      name: schema.games.name,
      puzzleRows: sql<number>`(${schema.games.puzzleSnapshot} ->> 'rows')::int`,
      puzzleCols: sql<number>`(${schema.games.puzzleSnapshot} ->> 'cols')::int`,
      puzzleBlocks: sql<number[]>`${schema.games.puzzleSnapshot} -> 'blocks'`,
      puzzleTitle: schema.puzzles.title,
      puzzleAuthor: schema.puzzles.author,
    })
    .from(schema.games)
    .innerJoin(
      schema.puzzles,
      eq(schema.puzzles.puzzleId, schema.games.puzzleId),
    )
    .leftJoin(
      schema.gameState,
      eq(schema.gameState.gameId, schema.games.gameId),
    )
    .where(eq(schema.games.gameId, gameId))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.completedAt === null) return null;

  // The room roster: display names and join order, the inputs to both the name lookup and the
  // room-aware wire-color assignment (assignRoomColors, the exact call the session's emitters make,
  // so the card's colors match the live roster and the client card).
  const members = await db
    .select({
      userId: schema.memberships.userId,
      name: schema.users.displayName,
      joinedAt: schema.memberships.joinedAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.userId, schema.memberships.userId))
    .where(eq(schema.memberships.gameId, gameId));

  const bundle = await gameAnalysis(db, gameId);
  if (bundle === null) return null;

  const wireColors = assignRoomColors(
    members.map((m) => ({
      userId: m.userId,
      joinedAt: m.joinedAt.toISOString(),
    })),
  );
  const nameById = new Map(members.map((m) => [m.userId, m.name]));

  // Card order: titled solvers first in WIRE (ladder-rank) order (SHARE.md "Credits keep wire
  // order"; the og card renders the credits in solver-array order, so titled-first-in-wire-order is
  // what makes the credits read ladder-ranked), then untitled owners in room (join) order, then any
  // owner the roster no longer knows (ascending id, deterministic). Byte-identical ordering to the
  // web assembly (shareCardData.ts), so both cards seat one room the same way.
  const ownerIds = new Set(Object.values(bundle.owners));
  const memberOrder = [...members].sort(
    (a, b) =>
      a.joinedAt.getTime() - b.joinedAt.getTime() ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const t of bundle.titles) push(t.userId);
  for (const m of memberOrder) if (ownerIds.has(m.userId)) push(m.userId);
  for (const id of [...ownerIds].filter((x) => !seen.has(x)).sort()) push(id);

  // The credit label per titled solver: the pinned label for the wire's title key (titleLabelOf, the
  // shared vector). At most one title per solver (the wire already guarantees it; the guard is
  // defensive), and an unknown key from a newer server credits the solver with no title line (the
  // PROTOCOL.md §12 MUST-ignore rule). LABELS ONLY: no detail line (client-owned, and the og variant
  // renders titles only).
  const labelById = new Map<string, string>();
  for (const t of bundle.titles) {
    if (labelById.has(t.userId)) continue;
    const label = titleLabelOf(t.title);
    if (label !== null) labelById.set(t.userId, label);
  }

  const solvers: ShareCardSolver[] = ids.map((id) => {
    const known = nameById.has(id);
    const wire = wireColors.get(id);
    const label = labelById.get(id);
    return {
      name: known ? (nameById.get(id) ?? FORMER_PARTICIPANT) : DEPARTED.name,
      colorLight:
        wire !== undefined ? identityColor(wire, false) : DEPARTED.light,
      colorDark: wire !== undefined ? identityColor(wire, true) : DEPARTED.dark,
      ...(label !== undefined && { title: { label } }),
    };
  });

  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const ownersByCell: Record<number, number> = {};
  for (const [cell, userId] of Object.entries(bundle.owners)) {
    const idx = indexOf.get(userId);
    if (idx !== undefined) ownersByCell[Number(cell)] = idx;
  }

  // The solo rule (SHARE.md): fewer than two writers ships empty titles (the engine's rule, echoed
  // in the bundle), so the mosaic repaints by fill order from the replay sequence.
  const solverCount = ownerIds.size;
  const solo = bundle.titles.length === 0 || solverCount < 2;

  const card: ShareCardData = {
    rows: row.puzzleRows,
    cols: row.puzzleCols,
    blocks: row.puzzleBlocks ?? [],
    ownersByCell,
    ...(solo && { fillOrderByCell: fillOrderOf(bundle.sequence) }),
    solvers,
    stats: {
      // The bundle's duration is active seconds by contract (PROTOCOL §12, D29).
      activeSeconds: bundle.momentum.durationSeconds,
      sittingCount: bundle.sittings.count,
      solverCount,
      squareCount: Object.keys(bundle.owners).length,
    },
    puzzle: {
      // Title falls back to the room name, then the board dims; author is only ever the real byline.
      title:
        row.puzzleTitle ?? row.name ?? `${row.puzzleCols} × ${row.puzzleRows}`,
      author: row.puzzleAuthor,
    },
    solvedOn: formatShareDate(row.completedAt),
  };

  return { card, sequence: bundle.sequence, solo };
}
