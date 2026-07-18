// The vote surface (the UX spec, beats 2-5). Desktop: the PROSCENIUM, the room-chrome strip above
// the grid transformed into the vote surface, full width, directly above the board (it replaces the
// clue strip and returns it on close). Mobile: a slim strip docked above the active-clue bar. One
// component, one store, one set of copy; the desktop bar and the mobile strip differ only in density.
//
// Input discipline (the UX spec): the verbs are keyboard-reachable buttons but focus is NEVER stolen
// (nothing here calls .focus()), so a solver typing into the grid loses no keystroke when the vote
// opens. The lifecycle is announced through a polite aria-live region; the ring is decorative and
// lives elsewhere, so the state a screen reader hears is this text.
import {
  CHECK_VERB,
  CHECK_VERB_INK,
  KEEP_VERB,
  WAITING_LINE,
} from "./voteView";
import type { ProposalSubject } from "./voteView";
import type { CheckVoteView } from "./useCheckVote";
import { VoteChips } from "./VoteChips";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

// The strip caps the chip row so the verbs are never pushed off a 390px screen (U8 mobile; the verb
// must never be unreachable). The Proscenium is uncapped: desktop has the room to show every face.
const STRIP_CHIP_CAP = 3;

/** The proposal line. The NAME rides its own truncate span; the verb phrase is a separate,
 * un-truncated span, so a long name can never swallow the verb (Wave 15.7). The proposer sees
 * "Waiting for the room" with no self-echo (owner ruling). `dense` lets the mobile strip drop the
 * verb phrase below `sm`, keeping the name and the chips and verbs on one line. */
function ProposalLine({
  proposal,
  dense,
}: {
  proposal: ProposalSubject;
  dense: boolean;
}) {
  const nameSize = dense ? "text-1" : "text-2";
  if (proposal.self) {
    return (
      <span
        className={`min-w-0 shrink truncate font-medium text-text ${nameSize}`}
      >
        {WAITING_LINE}
      </span>
    );
  }
  return (
    <span
      className={`flex min-w-0 shrink items-baseline gap-1 font-medium text-text ${nameSize}`}
    >
      <span className="min-w-0 max-w-[14ch] truncate">{proposal.name}</span>
      <span
        className={`shrink-0 whitespace-nowrap text-text-muted ${dense ? "hidden sm:inline" : ""}`}
      >
        wants to check the puzzle
      </span>
    </span>
  );
}

function ProposerAvatar({ view }: { view: CheckVoteView }) {
  const proposer = view.chips.find((c) => c.isProposer);
  if (proposer === undefined) return null;
  return (
    <Avatar size="sm" className="shrink-0 ring-2 ring-panel">
      {proposer.avatarUrl !== null && (
        <AvatarImage src={proposer.avatarUrl} alt="" />
      )}
      <AvatarFallback
        style={{ backgroundColor: proposer.color, color: "#fff" }}
      >
        {proposer.initial}
      </AvatarFallback>
    </Avatar>
  );
}

/** The verb pair. "Check it" is visually primary; both are substantial and keyboard-reachable. On a
 * cast the pair disables and fades IN PLACE (it never unmounts mid-click, which slid the chips), and
 * a locally-expired vote disables the verbs so a live verb never sits on an invisible ring (both via
 * `view.verbsDisabled`). The Check label rides a dark ink on the gold fill for AA (Wave 15.7). */
function Verbs({ view, size }: { view: CheckVoteView; size: "sm" | "xs" }) {
  return (
    <div
      className={`flex shrink-0 items-center gap-2 transition-opacity duration-200 motion-reduce:transition-none ${
        view.verbsDisabled ? "opacity-60" : ""
      }`}
    >
      <Button
        variant="secondary"
        size={size}
        disabled={view.verbsDisabled}
        onClick={view.onReject}
      >
        {KEEP_VERB}
      </Button>
      <Button
        variant="default"
        size={size}
        disabled={view.verbsDisabled}
        onClick={view.onApprove}
        style={{ color: CHECK_VERB_INK }}
      >
        {CHECK_VERB}
      </Button>
    </div>
  );
}

/** The resolution / recess text, and the proposer-only failed tally beneath it. */
function Resolution({ view }: { view: CheckVoteView }) {
  return (
    <div className="flex min-w-0 flex-1 items-baseline justify-center gap-2">
      <span className="truncate text-2 font-medium text-text">
        {view.resolutionText}
      </span>
      {view.tallyText !== null && (
        <span className="shrink-0 text-1 text-text-subtle tabular-nums">
          {view.tallyText}
        </span>
      )}
    </div>
  );
}

// One fixed band height across idle (ClueStrip), open (Proscenium), and resolution, so the board
// never lurches as the bar swaps (Wave 15.7 layout stability). The ClueStrip is a text-4 line
// (1.75rem) plus py-1.5 (0.75rem) plus its 1px dashed rule; the Proscenium and the resolution bar
// match it exactly here. Vertically centered so the shorter contents sit steady in the band.
const VOTE_BAND_MIN_H = "min-h-[calc(1.75rem+0.75rem+1px)]";

function ProsceniumBar({ view }: { view: CheckVoteView }) {
  const open = view.phase === "open";
  return (
    <div
      className={`vote-surface-enter hidden md:flex items-center gap-3 px-4 py-1.5 border-b border-dashed border-border-dashed bg-panel ${VOTE_BAND_MIN_H}`}
    >
      {open ? (
        <>
          <ProposerAvatar view={view} />
          <ProposalLine proposal={view.proposal} dense={false} />
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <VoteChips chips={view.chips} />
          </div>
          {view.showVerbs && <Verbs view={view} size="sm" />}
        </>
      ) : (
        <Resolution view={view} />
      )}
    </div>
  );
}

function VoteStrip({ view }: { view: CheckVoteView }) {
  const open = view.phase === "open";
  return (
    <div
      className={`vote-surface-enter md:hidden flex items-center gap-2 px-3 py-1.5 border-b border-dashed border-border-dashed bg-panel ${VOTE_BAND_MIN_H}`}
    >
      {open ? (
        <>
          <ProposalLine proposal={view.proposal} dense />
          <div className="ml-auto shrink-0">
            <VoteChips chips={view.chips} max={STRIP_CHIP_CAP} />
          </div>
          {view.showVerbs && <Verbs view={view} size="xs" />}
        </>
      ) : (
        <Resolution view={view} />
      )}
    </div>
  );
}

/** Renders both the desktop Proscenium and the mobile strip (mutually exclusive by breakpoint), plus
 * the polite live region. Mounts only when the view is active. */
export function CheckVoteSurface({ view }: { view: CheckVoteView }) {
  if (!view.active) {
    // Keep the live region mounted so an announcement that lands as the surface withdraws is not
    // dropped; it is empty when idle.
    return (
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
    );
  }
  return (
    <>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {view.ariaMessage}
      </div>
      <ProsceniumBar view={view} />
      <VoteStrip view={view} />
    </>
  );
}
