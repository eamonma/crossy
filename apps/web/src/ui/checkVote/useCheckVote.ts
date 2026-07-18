// The check-vote view state (PROTOCOL.md §6, §10; D32). The store owns correctness; this hook owns
// the choreography: the five beats (the call, the floor, the division, the reveal, the recess), the
// ring's clock tick, the polite announcements, and the copy resolved through voteView. It reads the
// store and forwards the store's vote-closed signal into React state so the reveal and the recess
// can play AFTER the vote leaves state. Motion respects prefers-reduced-motion throughout.
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
  proposerName,
  toFixLine,
  voteRole,
  type ElectorChip,
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

export interface CheckVoteRing {
  /** The open vote's absolute timeout; the ring drains against it. Frozen (null) once resolving. */
  readonly expiresAt: string | null;
  /** "open" drains; "passed" flashes and dissolves; "failed" fades. */
  readonly phase: "open" | "passed" | "failed";
  /** Bumps on each new vote so the ring remounts and replays its ignite. */
  readonly igniteKey: number;
  /** The current clock, so the ring recomputes its drain without owning a timer. */
  readonly nowMs: number;
}

export interface CheckVoteView {
  /** The Proscenium and the mobile strip render iff active (open, revealing, or recess). */
  readonly active: boolean;
  readonly phase: VotePhase;
  readonly vote: OpenCheckVote | null;
  readonly role: VoteRole | null;
  readonly chips: readonly ElectorChip[];
  readonly proposalText: string;
  /** The verbs show only to an elector who has not voted and has no ballot in flight. The proposer
   * and every observer (late joiner, spectator) see chips but no verbs. */
  readonly showVerbs: boolean;
  readonly pending: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
  /** The resolution line: "Checking…" then "{n} to fix" on a pass; the single calm line otherwise. */
  readonly resolutionText: string | null;
  /** The proposer-only tally after a failed vote ("{approvals} of {needed}"); null for everyone else. */
  readonly tallyText: string | null;
  readonly ring: CheckVoteRing | null;
  /** The wrong cells to wash in on a pass, ascending, with a key that changes once per reveal. */
  readonly wash: {
    readonly cells: readonly number[];
    readonly key: number;
  } | null;
  /** The beat-1 pulse origin as board percentages, or null (no cursor, or reduced motion). */
  readonly pulse: {
    readonly xPct: number;
    readonly yPct: number;
    readonly key: number;
  } | null;
  /** The polite live-region text (open and resolution), announced without stealing focus. */
  readonly ariaMessage: string;
  readonly reducedMotion: boolean;
}

/**
 * Drive the check-vote surface from the store. `selfCell` is the local cursor cell, the pulse origin
 * when self is the proposer; `cols`/`rows` place that origin. Everything the surface renders comes
 * from here, and every copy string flows through voteView, so the ceremony is one testable seam.
 */
export function useCheckVote(input: {
  store: GameStore;
  selfUserId: string | null;
  cols: number;
  rows: number;
  selfCell: number;
}): CheckVoteView {
  const { store, selfUserId, cols, rows, selfCell } = input;
  useSyncExternalStore(store.subscribe, store.getVersion);
  const reducedMotion = prefersReducedMotion();

  const rawVote = store.checkVote;
  const participants = store.participants;

  // A solo electorate of one auto-passes at the server (the open, close, and check arrive
  // back-to-back). It renders as an INSTANT check: no Proscenium, no ring, not for one frame (the
  // UX spec). We suppress the whole vote surface for it and let the marks apply as an ordinary
  // check; the solo client's confirm dialog was the ceremony.
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
  const [igniteKey, setIgniteKey] = useState(0);
  const [washKey, setWashKey] = useState(0);
  const [pulseKey, setPulseKey] = useState(0);

  // Refs so the close handler reads the latest vote/marks without re-subscribing.
  const lastVoteRef = useRef<OpenCheckVote | null>(vote);
  lastVoteRef.current = vote;
  const lastOpenedSeqRef = useRef<number | null>(vote?.openedSeq ?? null);
  const pulseOriginRef = useRef<{ xPct: number; yPct: number } | null>(null);
  const selfCellRef = useRef(selfCell);
  selfCellRef.current = selfCell;

  // A new vote just opened: ignite the ring and fire the pulse from the proposer's cursor.
  useEffect(() => {
    if (vote === null) return;
    if (lastOpenedSeqRef.current === vote.openedSeq && phase === "open") return;
    if (lastOpenedSeqRef.current !== vote.openedSeq) {
      lastOpenedSeqRef.current = vote.openedSeq;
      setPhase("open");
      setClose(null);
      setIgniteKey((k) => k + 1);
      if (!reducedMotion) {
        const originCell =
          vote.by === selfUserId
            ? selfCellRef.current
            : (store.cursors.get(vote.by)?.cell ?? null);
        if (originCell !== null && cols > 0 && rows > 0) {
          pulseOriginRef.current = {
            xPct: ((originCell % cols) + 0.5) * (100 / cols),
            yPct: (Math.floor(originCell / cols) + 0.5) * (100 / rows),
          };
          setPulseKey((k) => k + 1);
        } else {
          pulseOriginRef.current = null;
        }
      }
    }
  }, [vote, phase, reducedMotion, selfUserId, store, cols, rows]);

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

  // The ring's clock: tick while open so the drain tracks real time. Coarse under reduced motion
  // (the ring steps down instead of sweeping), fine otherwise. No timer while resolving.
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
  const chips = useMemo(
    () => (vote !== null ? electorChips(vote, participants, selfUserId) : []),
    [vote, participants, selfUserId],
  );

  const pending = store.pendingVote?.kind === "ballot";
  const selfVoted =
    vote !== null &&
    selfUserId !== null &&
    (vote.approvals.includes(selfUserId) ||
      vote.rejections.includes(selfUserId));
  const showVerbs = role === "elector" && !selfVoted && !pending;

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

  const proposalText =
    vote !== null
      ? proposalLine(proposerName(vote, participants, selfUserId))
      : "";

  const ring: CheckVoteRing | null = active
    ? {
        expiresAt: vote?.expiresAt ?? null,
        phase:
          phase === "revealing"
            ? "passed"
            : phase === "recess"
              ? "failed"
              : "open",
        igniteKey,
        nowMs,
      }
    : null;

  const wash =
    phase === "revealing" && !reducedMotion
      ? {
          cells: [...store.checkedWrongCells].sort((a, b) => a - b),
          key: washKey,
        }
      : null;

  const pulse =
    phase === "open" && pulseOriginRef.current !== null && !reducedMotion
      ? { ...pulseOriginRef.current, key: pulseKey }
      : null;

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
    proposalText,
    showVerbs,
    pending,
    onApprove: () => {
      if (vote !== null) store.castCheckVote(vote.openedSeq, true);
    },
    onReject: () => {
      if (vote !== null) store.castCheckVote(vote.openedSeq, false);
    },
    resolutionText,
    tallyText,
    ring,
    wash,
    pulse,
    ariaMessage,
    reducedMotion,
  };
}
