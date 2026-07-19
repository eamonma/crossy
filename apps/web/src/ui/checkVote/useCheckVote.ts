// The check-vote view state (PROTOCOL.md §6, §10; D32). The store owns correctness; this hook owns
// the choreography: the five beats (the call, the floor, the division, the reveal, the recess), the
// polite announcements, and the copy resolved through voteView. It reads the store and forwards the
// store's vote-closed signal into React state so the reveal and the recess can play AFTER the vote
// leaves state. Motion respects prefers-reduced-motion throughout. No clock renders (Wave 15.11 ring
// removal): expiry is felt only as the calm "The vote lapsed" line, and the chips settling are the
// vote's only live signal.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import type { GameStore, VoteClosedSignal } from "../../store/gameStore";
// The wire vote object (board.checkVote); aliased so it does not clash with this hook's own
// CheckVoteView view-model type below.
import type { CheckVoteView as OpenCheckVote } from "@crossy/protocol";
import {
  CHECKING_LINE,
  closeLine,
  electorChips,
  failedTallyLine,
  proposalLine,
  proposalSubject,
  remainingMs,
  toFixLine,
  voteRole,
  washSchedule,
  type ElectorChip,
  type ProposalSubject,
  type VoteRole,
} from "./voteView";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const BREATH_MS = 600; // the deliberate stillness before the reveal wash
const WASH_MS = 900; // the whole wrong-cell wash
const RECESS_MS = 2500; // the single calm line on a non-passing close

export type VotePhase = "idle" | "open" | "revealing" | "recess";

export interface CheckVoteView {
  /** The Proscenium and the mobile strip render iff active (open, revealing, or recess). */
  readonly active: boolean;
  readonly phase: VotePhase;
  readonly vote: OpenCheckVote | null;
  readonly role: VoteRole | null;
  readonly chips: readonly ElectorChip[];
  /** The proposal line's subject: the proposer sees the self subject (no self-echo), everyone else
   * the named subject, so the surface truncates only the name (Wave 15.7). */
  readonly proposal: ProposalSubject;
  /** The proposal line as a single string, for the polite live region only. */
  readonly proposalText: string;
  /** The verbs show only to an elector who has not settled. They stay mounted (disabled, faded) while
   * a ballot is in flight, so the block never unmounts mid-click (Wave 15.7). */
  readonly showVerbs: boolean;
  /** A ballot is in flight, or the vote has locally expired but not yet closed: the verbs disable and
   * fade IN PLACE, never leaving a live verb on a vote whose time has run out. */
  readonly verbsDisabled: boolean;
  readonly pending: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
  /** The resolution line: "Checking…" then "{n} to fix" on a pass; the single calm line otherwise. */
  readonly resolutionText: string | null;
  /** The proposer-only tally after a failed vote ("{approvals} of {needed}"); null for everyone else. */
  readonly tallyText: string | null;
  /** The wrong cells to wash in on a pass, ascending, with a key that changes once per reveal. */
  readonly wash: {
    readonly cells: readonly number[];
    readonly key: number;
  } | null;
  /** During a passed reveal (non-reduced): the standing red marks are held back per-cell so the gold
   * wash never plays over already-red cells (the spoil fix). Non-null means "suppress every standing
   * mark except these", growing on the wash schedule; null means apply marks as usual (idle, or
   * reduced motion, which reveals instantly). */
  readonly revealedWrongCells: ReadonlySet<number> | null;
  /** The polite live-region text (open and resolution), announced without stealing focus. */
  readonly ariaMessage: string;
  readonly reducedMotion: boolean;
}

/**
 * Drive the check-vote surface from the store. Everything the surface renders comes from here, and
 * every copy string flows through voteView, so the ceremony is one testable seam.
 */
export function useCheckVote(input: {
  store: GameStore;
  selfUserId: string | null;
}): CheckVoteView {
  const { store, selfUserId } = input;
  useSyncExternalStore(store.subscribe, store.getVersion);
  const reducedMotion = prefersReducedMotion();

  const rawVote = store.checkVote;
  const participants = store.participants;

  // A solo electorate of one auto-passes at the server (the open, close, and check arrive
  // back-to-back). It renders as an INSTANT check: no Proscenium, not for one frame (the UX spec).
  // We suppress the whole vote surface for it and let the marks apply as an ordinary check; the solo
  // client's confirm dialog was the ceremony.
  const soloVote = rawVote !== null && rawVote.electorate.length <= 1;
  const vote = soloVote ? null : rawVote;

  const [phase, setPhase] = useState<VotePhase>(
    vote !== null ? "open" : "idle",
  );
  const [close, setClose] = useState<{
    signal: VoteClosedSignal;
    approvals: number;
    needed: number;
    wasProposer: boolean;
  } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [washKey, setWashKey] = useState(0);
  // The wrong cells revealed so far in the current pass wash: empty at reveal start (the breath), then
  // grown per the wash schedule, so the standing red mark for a cell appears only as its own gold wash
  // fires (the spoil fix). Only consulted during a non-reduced revealing phase.
  const [revealedCells, setRevealedCells] = useState<ReadonlySet<number>>(
    () => new Set(),
  );

  // Refs so the close handler reads the latest vote/marks without re-subscribing.
  const lastVoteRef = useRef<OpenCheckVote | null>(vote);
  lastVoteRef.current = vote;
  const lastOpenedSeqRef = useRef<number | null>(vote?.openedSeq ?? null);

  // A new vote just opened: advance the beat machine to "open".
  useEffect(() => {
    if (vote === null) return;
    if (lastOpenedSeqRef.current === vote.openedSeq && phase === "open") return;
    if (lastOpenedSeqRef.current !== vote.openedSeq) {
      lastOpenedSeqRef.current = vote.openedSeq;
      setPhase("open");
      setClose(null);
    }
  }, [vote, phase]);

  // The vote-closed signal drives the reveal (passed) or the recess (failed/cancelled). Captured
  // from the store's forward, because the store clears `checkVote` on close.
  useEffect(() => {
    return store.subscribeVoteClosed((signal) => {
      const v = lastVoteRef.current;
      // A solo/instant vote (never surfaced) closes with no reveal and no recess: the marks apply
      // as an ordinary check. `v === null` at close means the vote never rendered, which only the
      // solo auto-pass produces.
      if (v === null) {
        setPhase("idle");
        setClose(null);
        return;
      }
      if (signal.outcome === "passed") {
        setPhase("revealing");
        setRevealedCells(new Set()); // hold every standing mark back until its wash fires
        setWashKey((k) => k + 1);
        return;
      }
      // failed or cancelled
      const line = closeLine(signal.outcome, signal.reason);
      if (line === null) {
        // terminal cancel: the completion / abandon UI supersedes, so no recess.
        setPhase("idle");
        setClose(null);
        return;
      }
      setClose({
        signal,
        approvals: v?.approvals.length ?? 0,
        needed: v?.needed ?? 0,
        // Captured now, because the store has cleared checkVote: the tally is the proposer's alone.
        wasProposer: v !== null && selfUserId !== null && v.by === selfUserId,
      });
      setPhase("recess");
    });
  }, [store, selfUserId]);

  // The reveal timer: hold the reveal for the breath plus the wash, then withdraw (unless a fresh
  // vote opened meanwhile). Reduced motion collapses the breath and wash to a short beat.
  useEffect(() => {
    if (phase !== "revealing") return;
    const dur = reducedMotion ? 300 : BREATH_MS + WASH_MS;
    const id = window.setTimeout(() => {
      setPhase((p) => (p === "revealing" ? "idle" : p));
    }, dur);
    return () => window.clearTimeout(id);
  }, [phase, washKey, reducedMotion]);

  // The per-cell mark reveal (the spoil fix): on a non-reduced pass, add each wrong cell to the
  // revealed set at its own wash delay, so its standing red mark appears as the gold wash lands on it,
  // never before. The set is held empty through the breath. `wrongCount` re-runs the schedule if the
  // puzzleChecked marks arrive a tick after the close (the batched case has them already). Reduced
  // motion never suppresses (revealedWrongCells stays null below), so it applies instantly.
  const wrongCount = store.checkedWrongCells.size;
  useEffect(() => {
    if (phase !== "revealing" || reducedMotion) return;
    const schedule = washSchedule([...store.checkedWrongCells]);
    const timers = schedule.map((step) =>
      window.setTimeout(() => {
        setRevealedCells((prev) => {
          if (prev.has(step.cell)) return prev;
          const next = new Set(prev);
          next.add(step.cell);
          return next;
        });
      }, step.delayMs),
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [phase, washKey, reducedMotion, wrongCount, store]);

  // The recess timer: the single calm line for ~2.5 s, then the surface withdraws.
  useEffect(() => {
    if (phase !== "recess") return;
    const id = window.setTimeout(() => {
      setPhase((p) => (p === "recess" ? "idle" : p));
      setClose(null);
    }, RECESS_MS);
    return () => window.clearTimeout(id);
  }, [phase, close]);

  // Track when the breath ends so "Checking…" gives way to "{n} to fix".
  const [breathDone, setBreathDone] = useState(false);
  useEffect(() => {
    if (phase !== "revealing") {
      setBreathDone(false);
      return;
    }
    if (reducedMotion) {
      setBreathDone(true);
      return;
    }
    const id = window.setTimeout(() => setBreathDone(true), BREATH_MS);
    return () => window.clearTimeout(id);
  }, [phase, washKey, reducedMotion]);

  // The local-expiry clock: tick while open so `expiredLocally` (below) can dim the verbs the moment
  // the vote's time runs out, before the server's close lands. No clock renders (Wave 15.11); this
  // drives only the verb dimming. Coarse under reduced motion, fine otherwise. No timer while resolving.
  useEffect(() => {
    if (phase !== "open") return;
    const period = reducedMotion ? 2000 : 100;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), period);
    return () => window.clearInterval(id);
  }, [phase, reducedMotion]);

  const active = vote !== null || phase === "revealing" || phase === "recess";
  const role: VoteRole | null =
    vote !== null ? voteRole(vote, selfUserId) : null;
  const pendingVote = store.pendingVote;
  const chips = useMemo(
    () =>
      vote !== null
        ? electorChips(vote, participants, selfUserId, pendingVote ?? null)
        : [],
    [vote, participants, selfUserId, pendingVote],
  );

  const pending = pendingVote?.kind === "ballot";
  const selfVoted =
    vote !== null &&
    selfUserId !== null &&
    (vote.approvals.includes(selfUserId) ||
      vote.rejections.includes(selfUserId));
  // The vote has run out of time locally but the close has not landed yet: a live verb must not sit
  // on a lapsed vote. The verbs stay mounted (so the block never slides) but disable.
  const expiredLocally =
    vote !== null &&
    phase === "open" &&
    (vote.expiresAt === null || remainingMs(vote.expiresAt, nowMs) === 0);
  // The verbs stay for a not-yet-settled elector even while a ballot is in flight, so casting never
  // unmounts the block mid-click; `verbsDisabled` fades and disables them in place.
  const showVerbs = role === "elector" && !selfVoted;
  const verbsDisabled = pending || expiredLocally;

  const resolutionText = useMemo(() => {
    if (phase === "revealing") {
      return breathDone
        ? toFixLine(store.checkedWrongCells.size)
        : CHECKING_LINE;
    }
    if (phase === "recess" && close !== null) {
      return closeLine(close.signal.outcome, close.signal.reason);
    }
    return null;
  }, [phase, breathDone, close, store.checkedWrongCells.size]);

  // Proposer-only, after a FAILED vote: "{approvals} of {needed}". No other counts ever show to the
  // room. Gated on wasProposer captured at close, since the vote is gone from state by now.
  const tallyText =
    phase === "recess" &&
    close !== null &&
    close.signal.outcome === "failed" &&
    close.wasProposer &&
    close.needed > 0
      ? failedTallyLine(close.approvals, close.needed)
      : null;

  const proposal: ProposalSubject =
    vote !== null
      ? proposalSubject(vote, participants, selfUserId)
      : { self: false, name: "" };
  const proposalText = vote !== null ? proposalLine(proposal) : "";

  const wash =
    phase === "revealing" && !reducedMotion
      ? {
          cells: [...store.checkedWrongCells].sort((a, b) => a - b),
          key: washKey,
        }
      : null;

  // Suppress the standing red per-cell during a non-reduced pass reveal; null everywhere else lets the
  // grid paint marks as usual (idle, or reduced motion which reveals instantly).
  const revealedWrongCells =
    phase === "revealing" && !reducedMotion ? revealedCells : null;

  const ariaMessage = useMemo(() => {
    if (phase === "open" && vote !== null) return proposalText;
    if (resolutionText !== null) return resolutionText;
    return "";
  }, [phase, vote, proposalText, resolutionText]);

  return {
    active,
    phase,
    vote,
    role,
    chips,
    proposal,
    proposalText,
    showVerbs,
    verbsDisabled,
    pending,
    onApprove: () => {
      if (vote !== null) store.castCheckVote(vote.openedSeq, true);
    },
    onReject: () => {
      if (vote !== null) store.castCheckVote(vote.openedSeq, false);
    },
    resolutionText,
    tallyText,
    wash,
    revealedWrongCells,
    ariaMessage,
    reducedMotion,
  };
}
