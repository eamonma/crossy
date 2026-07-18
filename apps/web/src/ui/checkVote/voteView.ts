// Pure derivations for the check-vote surface (PROTOCOL.md §4, §6, §10; DESIGN.md D32). The store
// owns the wire state (checkVote, the three events, the ballot intent); this module owns what the
// Proscenium, the ring, the chips, and the mobile strip render from it: the exact copy, the
// remaining-time clamp, solo detection, the elector chips, and the resolution lines. Kept pure and
// data-in/data-out so the whole vote UX is testable under the node suite, the roomActions.ts posture.
import type {
  CheckVoteCloseReason,
  CheckVoteOutcome,
  CheckVoteView,
  Participant,
} from "@crossy/protocol";

/** The check vote's timebox (DESIGN.md D32 open question CHECK_VOTE_TTL_MS). The ring is the only
 * clock, and it drains over this window; the server's `expiresAt` is authoritative, this is only the
 * clamp ceiling that keeps clock skew from ever showing more than a full ring. */
export const CHECK_VOTE_TTL_MS = 30_000;

// --- Copy (exact strings; the UX spec is normative for this wave) ---

/** The proposal line is subject-aware (owner ruling): the proposer sees no self-echo, only that the
 * room is deciding; everyone else sees the named request. `self` collapses the whole sentence, so the
 * proposer's line never reads "You wants/want…". */
export type ProposalSubject = { self: true } | { self: false; name: string };

/** The proposer's own line: no self-echo, just that the floor is the room's now (owner ruling). */
export const WAITING_LINE = "Waiting for the room";

export function proposalLine(subject: ProposalSubject): string {
  return subject.self
    ? WAITING_LINE
    : `${subject.name} wants to check the puzzle`;
}

/** The two ballot verbs. "Check it" is visually primary; both are substantial. */
export const CHECK_VERB = "Check it";
export const KEEP_VERB = "Keep solving";

/** The Check verb's label ink. gold-9 (#978365, theme-fixed) fails AA under white 12px (3.65:1);
 * a warm near-black ink on the same ceremony gold clears AA in both themes (contrastRatio test). */
export const CHECK_VERB_INK = "#171307";

/** The passed-vote resolution: "Checking…" during the breath, then "{n} to fix" as the marks land. */
export const CHECKING_LINE = "Checking…";
export function toFixLine(wrongCount: number): string {
  return `${wrongCount} to fix`;
}

/** The proposer-only tally after a FAILED vote: "{approvals} of {needed}". No other counts ever show
 * to the room; the room reads faces, not numbers (the UX spec). */
export function failedTallyLine(approvals: number, needed: number): string {
  return `${approvals} of ${needed}`;
}

/**
 * The single calm line a non-passing close shows for ~2.5 s (the recess). Rejection, expiry, and a
 * grid-broken cancel each have their own words; a terminal cancel needs no line, because the
 * completion or abandon UI supersedes it. A passed close is not handled here (it flows through
 * CHECKING_LINE then toFixLine). Returns null when no line should show.
 */
export function closeLine(
  outcome: CheckVoteOutcome,
  reason: CheckVoteCloseReason | undefined,
): string | null {
  if (outcome === "passed") return null; // the reveal beat, not a calm line
  if (outcome === "failed") {
    return reason === "EXPIRED" ? "The vote lapsed" : "The room keeps solving";
  }
  // cancelled
  if (reason === "GRID_BROKEN") return "Vote ended, the grid changed";
  return null; // TERMINAL: the completion / abandon UI supersedes
}

// --- Timebox ---

/** Remaining milliseconds, clamped to [0, ttlMs] (the UX spec: never trust it below 0 or above the
 * TTL, clock skew). A malformed or absent `expiresAt` reads as expired. */
export function remainingMs(
  expiresAt: string,
  nowMs: number,
  ttlMs: number = CHECK_VOTE_TTL_MS,
): number {
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) return 0;
  return Math.min(ttlMs, Math.max(0, expires - nowMs));
}

/** The ring's drain fraction, 1 at open falling to 0 at expiry. */
export function remainingFraction(
  expiresAt: string,
  nowMs: number,
  ttlMs: number = CHECK_VOTE_TTL_MS,
): number {
  return remainingMs(expiresAt, nowMs, ttlMs) / ttlMs;
}

/** The coarse step the ring drops to under prefers-reduced-motion (no continuous sweep): the drain
 * fraction quantized up to the next 1/steps, so it steps down at coarse intervals instead. */
export function coarseOpacityStep(fraction: number, steps: number = 4): number {
  const clamped = Math.min(1, Math.max(0, fraction));
  return Math.ceil(clamped * steps) / steps;
}

// --- The reveal wash schedule (U6; the timings are verified correct, so they are pinned here) ---

/** The deliberate stillness before the wash (U6): "Checking…" holds this long before tile zero. */
export const REVEAL_BREATH_MS = 600;

/** Per-cell stagger: the whole wash stays under ~900 ms after the breath (a 360 ms tile plus the
 * last start by ~500 ms), so the gap shrinks as the count grows, clamped to a 60 ms ceiling. */
export function washPerCellMs(n: number): number {
  return n > 1 ? Math.min(60, 500 / (n - 1)) : 0;
}

export interface WashStep {
  readonly cell: number;
  readonly delayMs: number;
}

/** The wrong cells to wash in ascending order, each with its absolute delay off reveal start (the
 * breath plus its rank's stagger). One schedule drives both the wash tiles and the per-cell mark
 * reveal, so the standing red never precedes its own gold wash (the spoil fix). */
export function washSchedule(cells: readonly number[]): readonly WashStep[] {
  const sorted = [...cells].sort((a, b) => a - b);
  const per = washPerCellMs(sorted.length);
  return sorted.map((cell, rank) => ({
    cell,
    delayMs: REVEAL_BREATH_MS + Math.round(rank * per),
  }));
}

// --- The Meridian ring (U4; Wave 15.7): a true parallel offset of the square-cornered board ---

/**
 * The ring's drain, expressed as a stroke-dashoffset against a path of pathLength 1 whose start is
 * the top-center seam (meridianPath). The remaining glow occupies [1-fraction, 1], so the gap opens
 * at the seam and widens CLOCKWISE as time drains: offset 0 is a whole ring, offset -1 is empty at
 * the seam. Reduced motion holds the ring whole (offset 0) and steps opacity instead of sweeping.
 */
export function ringDashOffset(
  fraction: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 0;
  const f = Math.min(1, Math.max(0, fraction));
  return f - 1;
}

/**
 * A rounded-rect path that is a parallel offset of the square board, drawn CLOCKWISE from the
 * top-center seam so the drain reads as a clock, not a rendering glitch. The corner radius equals the
 * offset gap (passed in), which makes the curve optically parallel to the square board corner. The
 * geometry is in the SVG's pixel space (LuminousRing measures the halo box 1:1), so `weight` insets
 * the stroke centerline by half its width on every edge.
 */
export function meridianPath(
  w: number,
  h: number,
  radius: number,
  weight: number,
): string {
  const x0 = weight / 2;
  const y0 = weight / 2;
  const boxW = Math.max(0, w - weight);
  const boxH = Math.max(0, h - weight);
  const r = Math.max(0, Math.min(radius, boxW / 2, boxH / 2));
  const cx = x0 + boxW / 2;
  const right = x0 + boxW;
  const bottom = y0 + boxH;
  const n = (v: number): string => String(Math.round(v * 1000) / 1000);
  return [
    `M ${n(cx)} ${n(y0)}`, // the top-center seam
    `H ${n(right - r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(right)} ${n(y0 + r)}`, // top-right corner, clockwise
    `V ${n(bottom - r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(right - r)} ${n(bottom)}`, // bottom-right
    `H ${n(x0 + r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(x0)} ${n(bottom - r)}`, // bottom-left
    `V ${n(y0 + r)}`,
    `A ${n(r)} ${n(r)} 0 0 1 ${n(x0 + r)} ${n(y0)}`, // top-left
    `H ${n(cx)}`, // back along the top to the seam
    "Z",
  ].join(" ");
}

// --- Contrast (WCAG relative luminance; the audit gate for the ceremony's controls) ---

function channelLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (m === null) return 0;
  const int = parseInt(m[1]!, 16);
  const r = (int >> 16) & 0xff;
  const g = (int >> 8) & 0xff;
  const b = int & 0xff;
  return (
    0.2126 * channelLinear(r) +
    0.7152 * channelLinear(g) +
    0.0722 * channelLinear(b)
  );
}

/** The WCAG contrast ratio between two opaque sRGB hex colors, in [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// --- Electorate and roles ---

function isElectorRole(p: Participant): boolean {
  return p.role === "host" || p.role === "solver";
}

/** The connected host/solver members: the pool the server would freeze as an electorate right now. */
export function connectedElectors(
  participants: readonly Participant[],
): readonly Participant[] {
  return participants.filter((p) => p.connected && isElectorRole(p));
}

/**
 * Solo detection (the UX spec): the client is solo when it is the only CONNECTED host/solver in the
 * room. A solo proposal auto-passes at the server, so the solo client keeps its confirm dialog and
 * NO vote chrome ever appears. Returns false when self is not a connected elector (a spectator never
 * proposes) or when another connected elector exists.
 */
export function isSoloElector(
  participants: readonly Participant[],
  selfUserId: string | null,
): boolean {
  if (selfUserId === null) return false;
  const electors = connectedElectors(participants);
  return electors.length === 1 && electors[0]!.userId === selfUserId;
}

export type VoteRole = "proposer" | "elector" | "observer";

/** This client's standing in the open vote: the proposer (chips, no verbs), an elector (chips and
 * verbs), or an observer (a late joiner or spectator: the Proscenium read-only, no verbs). */
export function voteRole(
  vote: CheckVoteView,
  selfUserId: string | null,
): VoteRole {
  if (selfUserId !== null && vote.by === selfUserId) return "proposer";
  if (selfUserId !== null && vote.electorate.includes(selfUserId)) {
    return "elector";
  }
  return "observer";
}

export type ChipSide = "check" | "keep" | "undecided";

/** Which side an elector's chip has settled to. The proposer is pre-settled to "check" from the
 * start, because their proposal is their approval (§10). */
export function chipSide(vote: CheckVoteView, userId: string): ChipSide {
  if (vote.approvals.includes(userId)) return "check";
  if (vote.rejections.includes(userId)) return "keep";
  return "undecided";
}

export function hasVoted(vote: CheckVoteView, userId: string): boolean {
  return chipSide(vote, userId) !== "undecided";
}

/** A local ballot intent in flight (gameStore.pendingVote): the proposer's proposal or an elector's
 * ballot, keyed by command id in the store. The view reads only its kind and approve to settle the
 * self chip optimistically, before the authoritative echo lands. */
export interface PendingVoteIntent {
  readonly kind: "propose" | "ballot";
  readonly approve?: boolean;
}

/** The self chip's side, settled optimistically from a pending ballot when the wire has not yet
 * recorded it (the store's promise). The wire always wins once it lands; a pending propose (not a
 * ballot) never moves a chip here, because the proposer is already pre-settled to check. */
function optimisticSide(
  vote: CheckVoteView,
  userId: string,
  pending: PendingVoteIntent | null,
): ChipSide {
  const settled = chipSide(vote, userId);
  if (settled !== "undecided") return settled;
  if (
    pending !== null &&
    pending.kind === "ballot" &&
    pending.approve !== undefined
  ) {
    return pending.approve ? "check" : "keep";
  }
  return "undecided";
}

/** One elector's chip. `side` drives the settle animation; `undecided` renders dimmed (not yet
 * voted). Identity color/avatar come from the participant, the same chips the roster paints. */
export interface ElectorChip {
  readonly userId: string;
  readonly name: string;
  readonly initial: string;
  readonly avatarUrl: string | null;
  readonly color: string;
  readonly side: ChipSide;
  readonly isSelf: boolean;
  readonly isProposer: boolean;
}

/**
 * The elector chips in electorate order (ascending userId, INV-1), each resolved against the live
 * participant list for its name/avatar/color. An elector who has left the room still shows (the
 * electorate is frozen for the vote's life, §10) with a placeholder identity.
 */
export function electorChips(
  vote: CheckVoteView,
  participants: readonly Participant[],
  selfUserId: string | null,
  selfPending: PendingVoteIntent | null = null,
): readonly ElectorChip[] {
  const byId = new Map(participants.map((p) => [p.userId, p]));
  return vote.electorate.map((userId) => {
    const p = byId.get(userId);
    const name = p?.displayName ?? "Player";
    const isSelf = userId === selfUserId;
    return {
      userId,
      name,
      initial: name.charAt(0).toUpperCase() || "?",
      avatarUrl: p?.avatarUrl ?? null,
      color: p?.color ?? "#8C99BA",
      // The self chip settles the instant you cast, from the pending ballot; the wire wins on echo.
      side: optimisticSide(vote, userId, isSelf ? selfPending : null),
      isSelf,
      isProposer: userId === vote.by,
    };
  });
}

/** The proposer's display name off the participant list, for the proposal line. Falls back to a
 * neutral noun so the line never renders "undefined wants to check the puzzle". */
export function proposerName(
  vote: CheckVoteView,
  participants: readonly Participant[],
  selfUserId: string | null,
): string {
  if (selfUserId !== null && vote.by === selfUserId) return "You";
  const p = participants.find((m) => m.userId === vote.by);
  return p?.displayName ?? "A teammate";
}

/**
 * The proposal line's subject (owner ruling): the proposer sees the self subject (no name, no
 * self-echo), everyone else the named subject. A missing participant or a blank display name falls
 * back to the neutral "A teammate", so the line never renders "  wants to check the puzzle".
 */
export function proposalSubject(
  vote: CheckVoteView,
  participants: readonly Participant[],
  selfUserId: string | null,
): ProposalSubject {
  if (selfUserId !== null && vote.by === selfUserId) return { self: true };
  const p = participants.find((m) => m.userId === vote.by);
  const name = p?.displayName?.trim();
  return {
    self: false,
    name: name !== undefined && name.length > 0 ? name : "A teammate",
  };
}
