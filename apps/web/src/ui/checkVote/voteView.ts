// Pure derivations for the check-vote surface (PROTOCOL.md §4, §6, §10; DESIGN.md D32). The store
// owns the wire state (checkVote, the three events, the ballot intent); this module owns what the
// Proscenium, the chips, and the mobile strip render from it: the exact copy, the remaining-time
// clamp, solo detection, the elector chips, and the resolution lines. Kept pure and data-in/data-out
// so the whole vote UX is testable under the node suite, the roomActions.ts posture.
import type {
  CheckVoteCloseReason,
  CheckVoteOutcome,
  CheckVoteView,
  Participant,
} from "@crossy/protocol";

/** The check vote's timebox (DESIGN.md D32 open question CHECK_VOTE_TTL_MS). No clock renders (Wave
 * 15.11 ring removal); the server's `expiresAt` is authoritative, and this is only the clamp ceiling
 * that keeps clock skew from ever reading more than a full window for the local-expiry verb dimming. */
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
 * TTL, clock skew). A malformed or absent `expiresAt` reads as expired. Drives the local-expiry verb
 * dimming (Wave 15.7); no clock renders it. */
export function remainingMs(
  expiresAt: string,
  nowMs: number,
  ttlMs: number = CHECK_VOTE_TTL_MS,
): number {
  const expires = Date.parse(expiresAt);
  if (Number.isNaN(expires)) return 0;
  return Math.min(ttlMs, Math.max(0, expires - nowMs));
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
