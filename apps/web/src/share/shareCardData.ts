// The share card's data assembly: everything between the analysis bundle and
// @crossy/share-card's pure builder, kept out of the export adapter so it is testable
// under the node vitest environment (the analysisReadout.ts split). This module owns:
//
//   - the solver roster for the card: titled solvers first, in WIRE order (the server
//     ships titles ladder-ranked, TITLES.md; reordering here would fork the surfaces),
//     then untitled owners in room order; every solver resolves BOTH ground hexes
//     through the shared identity palette so one player wears one color on either card.
//   - the title copy, reused verbatim from titlesReadout.ts TITLE_COPY (the Titles
//     panel's words; the card never forks a string).
//   - the solo rule: fewer than two writers (the wire's empty titles, TITLES.md solo
//     rule, or a single-owner board) paints the mosaic by fill order from the replay
//     sequence instead of owners.
//   - display fallbacks: puzzle title -> room name -> the board dims; the date is
//     formatted here from an injected Date (fixed English month names, a display
//     string, never normalized or compared, so INV-1 casing is untouched).
//
// Everything on the card is owners, counts, and display metadata: no letter can enter
// because none is accepted as input (INV-6 in spirit; the bundle carries none either).
import type { ShareCardData, ShareCardSolver } from "@crossy/share-card";
import type { AnalysisResponse } from "../ui/completionAttribution";
import { titleCopyOf } from "../ui/titlesReadout";
import { identityColor } from "../ui/identityRoster";

/** The member facts the card needs: id, display name, wire color (the same fields the
 * legend reads off StackMember). */
export interface ShareMember {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
}

/** Everything the Share button carries; assembled lazily into ShareCardData on tap.
 * Plain data, so the button can hold it without importing the heavy export module. */
export interface ShareCardInput {
  readonly bundle: AnalysisResponse;
  readonly members: readonly ShareMember[];
  readonly cols: number;
  readonly rows: number;
  readonly blocks: readonly number[];
  /** From the expanded GET /games/{id} (PROTOCOL.md §12); null on an older server. */
  readonly puzzleTitle: string | null;
  readonly puzzleAuthor: string | null;
  /** The room's display name, the title's first fallback. */
  readonly roomName: string | null;
  readonly gameId: string;
}

export interface ShareAssembly {
  readonly data: ShareCardData;
  readonly variant: "portrait" | "solo";
  readonly filename: string;
}

/** A solver the snapshot no longer knows (a departed member who still owns squares):
 * the legend's neutral treatment, one fixed hex per ground. */
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

/** "Jul 17, 2026" from the client clock: fixed English month names, so the string is
 * stable across devices (a display string, never compared; INV-1 untouched). */
export function formatShareDate(d: Date): string {
  return `${MONTHS[d.getMonth()]!} ${d.getDate()}, ${d.getFullYear()}`;
}

/** The card ground for the html data-theme attribute (useTheme stamps it). */
export function groundFromTheme(attr: string | null): "light" | "dark" {
  return attr === "dark" ? "dark" : "light";
}

/** The export filename: a stable, short handle on the game. */
export function shareFilename(gameId: string): string {
  return `crossy-${gameId.slice(0, 8)}.png`;
}

/**
 * The fill-order map for the solo mosaic: the replay sequence (ascending by (at, seq)
 * on the wire) mapped to [0, 1] by rank. A single fill reads 0 (the pale end); an
 * empty sequence yields an empty map (cells rest on the bare face).
 */
export function fillOrderOf(
  sequence: readonly { cell: number; atSeconds: number }[],
): Record<number, number> {
  const out: Record<number, number> = {};
  const n = sequence.length;
  sequence.forEach((entry, i) => {
    out[entry.cell] = n > 1 ? i / (n - 1) : 0;
  });
  return out;
}

/**
 * Assemble the card's data from the bundle and the room. Pure: the clock arrives as
 * `now`, so a test pins the date; same inputs, same assembly.
 */
export function assembleShareCard(
  input: ShareCardInput,
  now: Date,
): ShareAssembly {
  const { bundle, members } = input;
  const ownerIds = new Set(Object.values(bundle.owners));
  const byId = new Map(members.map((m) => [m.userId, m]));

  // Card order: titled solvers in wire (ladder) order, then untitled owners in room
  // order, then any owner the snapshot no longer knows (ascending id, deterministic).
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (id: string): void => {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const t of bundle.titles) push(t.userId);
  for (const m of members) if (ownerIds.has(m.userId)) push(m.userId);
  for (const id of [...ownerIds].filter((x) => !seen.has(x)).sort()) push(id);

  // The words are the Titles panel's own (TITLE_COPY via titleCopyOf); an unknown key
  // from a newer server credits the solver with no title line (the MUST-ignore rule).
  const titleOf = new Map<
    string,
    { label: string; detail?: string } | undefined
  >();
  for (const t of bundle.titles) {
    if (titleOf.has(t.userId)) continue;
    const copy = titleCopyOf(t.title);
    if (copy === null) continue;
    const detail = copy.detail(t.evidence);
    titleOf.set(t.userId, {
      label: copy.label,
      ...(detail !== null && { detail }),
    });
  }

  const solvers: ShareCardSolver[] = ids.map((id) => {
    const m = byId.get(id);
    const title = titleOf.get(id);
    return {
      name: m?.name ?? DEPARTED.name,
      colorLight:
        m !== undefined ? identityColor(m.color, false) : DEPARTED.light,
      colorDark: m !== undefined ? identityColor(m.color, true) : DEPARTED.dark,
      ...(title !== undefined && { title }),
    };
  });

  const indexOf = new Map(ids.map((id, i) => [id, i]));
  const ownersByCell: Record<number, number> = {};
  for (const [cell, userId] of Object.entries(bundle.owners)) {
    const idx = indexOf.get(userId);
    if (idx !== undefined) ownersByCell[Number(cell)] = idx;
  }

  // The solo rule: a room with fewer than two writers ships empty titles (TITLES.md);
  // a single-owner board is the same story on an older bundle. Fill order, not owners.
  const solverCount = ownerIds.size;
  const solo = bundle.titles.length === 0 || solverCount < 2;

  const data: ShareCardData = {
    rows: input.rows,
    cols: input.cols,
    blocks: input.blocks,
    ownersByCell,
    ...(solo && { fillOrderByCell: fillOrderOf(bundle.sequence) }),
    solvers,
    stats: {
      // The bundle's duration is active seconds by contract (PROTOCOL §12, D29).
      activeSeconds: bundle.momentum.durationSeconds,
      sittingCount: bundle.sittings?.count ?? 1,
      solverCount,
      squareCount: Object.keys(bundle.owners).length,
    },
    puzzle: {
      // Title falls back room name, then dims; author only ever the real byline.
      title:
        input.puzzleTitle ?? input.roomName ?? `${input.cols} × ${input.rows}`,
      author: input.puzzleAuthor,
    },
    solvedOn: formatShareDate(now),
  };

  return {
    data,
    variant: solo ? "solo" : "portrait",
    filename: shareFilename(input.gameId),
  };
}
