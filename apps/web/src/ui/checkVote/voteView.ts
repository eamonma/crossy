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

/** The proposal line: "{name} wants to check the puzzle". */
export function proposalLine(name: string): string {
  return `${name} wants to check the puzzle`;
}

/** The two ballot verbs. "Check it" is visually primary; both are substantial. */
export const CHECK_VERB = "Check it";
export const KEEP_VERB = "Keep solving";

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
): readonly ElectorChip[] {
  const byId = new Map(participants.map((p) => [p.userId, p]));
  return vote.electorate.map((userId) => {
    const p = byId.get(userId);
    const name = p?.displayName ?? "Player";
    return {
      userId,
      name,
      initial: name.charAt(0).toUpperCase() || "?",
      avatarUrl: p?.avatarUrl ?? null,
      color: p?.color ?? "#8C99BA",
      side: chipSide(vote, userId),
      isSelf: userId === selfUserId,
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
