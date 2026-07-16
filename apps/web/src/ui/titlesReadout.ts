// The Titles section's pure core: the display copy for the pinned award ladder and the
// wire-to-card resolution, kept out of AnalysisPanel.tsx so it is testable under the node
// vitest environment (vite.config.ts pins environment: "node", include src/**/*.test.ts),
// the same split analysisReadout.ts and completionAttribution.ts already keep.
//
// The wire carries only the key and the evidence (PROTOCOL §12); display copy belongs to
// the clients (TITLES.md "The v1 ladder"). This module owns the web's words: one entry per
// ladder key, each a label ("The saboteur") and a detail line that folds the evidence in
// per that rung's semantics (a count, a whole-seconds duration, or none). The copy obeys
// the amended law: a title cites its own number and nothing else — no rate, no rank, no
// two people's numbers against each other.
//
// Forward compatibility (PROTOCOL §12): the ladder grows server-first, so a client MUST
// ignore an unknown key. titleCards drops any award whose key has no copy here, which is
// exactly how an older build renders a newer server: fewer cards, never a crash.
import type { TitleKey } from "@crossy/engine";
import { BURST_WINDOW_MS } from "@crossy/engine";
import type { Roster } from "./mosaicReveal";
import type { WireTitle } from "./completionAttribution";
import type { LegendMember } from "./analysisReadout";
import { colorOf, formatMSS, nameOf } from "./analysisReadout";

/** The copy for one ladder rung: the card's caps label and its evidence line. `detail`
 * is total over the wire's `number | null`: a rung whose evidence is a count formats it
 * (and returns null if the number is unexpectedly missing, dropping the line rather than
 * printing "null"); a rung whose evidence is none returns its fixed line. */
export interface TitleCopy {
  readonly label: string;
  readonly detail: (evidence: number | null) => string | null;
}

/** "7 correct squares" / "1 correct square": a count with a naive plural, so a floor
 * title earned on a single square never reads "1 squares". */
function counted(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

/** Lift a count formatter over the wire's nullable evidence: null in, null out (the line
 * is dropped), so a numeric rung can never render a missing number. */
function withCount(format: (n: number) => string) {
  return (evidence: number | null): string | null =>
    evidence === null ? null : format(evidence);
}

/** The burst window in whole seconds, derived from the shared engine constant so the
 * sprinter's copy can never drift from the number the stat was counted over. */
const BURST_WINDOW_SECONDS = Math.floor(BURST_WINDOW_MS / 1000);

/**
 * The web's copy for the pinned v1 ladder (TITLES.md sets the register; the words are
 * the client's). Keyed by the engine's TitleKey so a ladder edit that adds a key is a
 * compile error here until the copy exists. Evidence semantics per rung follow the
 * ladder table: counts render as counts, the two whole-seconds rungs (ice-breaker's
 * stall, long-hauler's span) render M:SS through the same formatMSS the header and the
 * ribbon gloss use, and the two no-evidence rungs carry a fixed line.
 */
export const TITLE_COPY: Record<TitleKey, TitleCopy> = {
  saboteur: {
    label: "The saboteur",
    detail: withCount((n) => `Overwrote ${counted(n, "correct square")}`),
  },
  "one-hit-wonder": {
    label: "The one-hit wonder",
    detail: () => "One square, flawlessly chosen",
  },
  "ice-breaker": {
    label: "The ice breaker",
    detail: withCount((n) => `Ended the room's ${formatMSS(n)} silence`),
  },
  bullseye: {
    label: "The bullseye",
    detail: withCount((n) => `${counted(n, "square")}, none wrong`),
  },
  headliner: {
    label: "The headliner",
    detail: withCount((n) => `Led ${n} of the long ones`),
  },
  sprinter: {
    label: "The sprinter",
    detail: withCount(
      (n) => `${counted(n, "square")} in ${BURST_WINDOW_SECONDS} seconds`,
    ),
  },
  meddler: {
    label: "The meddler",
    detail: withCount((n) => `Finished ${counted(n, "word")} others started`),
  },
  "quick-starter": {
    label: "The quick starter",
    detail: withCount((n) => `${counted(n, "square")} in the opening stretch`),
  },
  closer: {
    label: "The closer",
    detail: withCount((n) => `${counted(n, "square")} in the closing stretch`),
  },
  specialist: {
    label: "The specialist",
    detail: withCount((n) => `Kept to one corner, ${counted(n, "square")}`),
  },
  "long-hauler": {
    label: "The long hauler",
    detail: withCount((n) => `On the case for ${formatMSS(n)}`),
  },
  wanderer: {
    label: "The wanderer",
    detail: () => "Roamed the whole grid",
  },
  scribbler: {
    label: "The scribbler",
    detail: withCount((n) => `Busiest pencil, ${counted(n, "letter")} down`),
  },
  collector: {
    label: "The collector",
    detail: withCount((n) => `Had a hand in ${counted(n, "word")}`),
  },
  workhorse: {
    label: "The workhorse",
    detail: withCount((n) => `${counted(n, "square")} filled`),
  },
};

/** The copy for a wire key, or null for a key this build does not know (a newer server's
 * ladder; the caller drops the award, the MUST-ignore rule). Object.hasOwn guards the
 * lookup so a hostile key ("constructor") can never reach the record's prototype. */
export function titleCopyOf(key: string): TitleCopy | null {
  return Object.hasOwn(TITLE_COPY, key) ? TITLE_COPY[key as TitleKey] : null;
}

/** One Titles card, ready to render: the solver's identity (name resolved self-as-You,
 * color through the mosaic's roster, null for a departed member -> the neutral dot) and
 * the words (label + optional evidence line). */
export interface TitleCard {
  readonly userId: string;
  readonly name: string;
  readonly color: string | null;
  readonly label: string;
  readonly detail: string | null;
}

/**
 * Resolve the wire's titles into cards, in wire order (the server orders by ladder rank,
 * most memorable first; reordering client-side would fork the two platforms' surfaces).
 * An unknown key is skipped, never a crash and never a placeholder (PROTOCOL §12: a
 * client MUST ignore an unknown key; that is how the ladder grows without client
 * lockstep). Identity resolves through the same nameOf/colorOf the moment cards used, so
 * a titled solver wears exactly the legend's name and the mosaic's color. An empty array
 * yields no cards, and the panel renders no section (the solo rule; deliberate).
 */
export function titleCards(
  titles: readonly WireTitle[],
  members: readonly LegendMember[],
  selfId: string | null,
  roster: Roster,
): TitleCard[] {
  const cards: TitleCard[] = [];
  for (const award of titles) {
    const copy = titleCopyOf(award.title);
    if (copy === null) continue;
    cards.push({
      userId: award.userId,
      name: nameOf(members, award.userId, selfId),
      color: colorOf(roster, award.userId),
      label: copy.label,
      detail: copy.detail(award.evidence),
    });
  }
  return cards;
}
