// The vote surface (the UX spec, beats 2-5). Desktop: the PROSCENIUM, the room-chrome strip above
// the grid transformed into the vote surface, full width, directly above the board (it replaces the
// clue strip and returns it on close). Mobile: a slim strip docked above the active-clue bar. One
// component, one store, one set of copy; the desktop bar and the mobile strip differ only in density.
//
// Input discipline (the UX spec): the verbs are keyboard-reachable buttons but focus is NEVER stolen
// (nothing here calls .focus()), so a solver typing into the grid loses no keystroke when the vote
// opens. The lifecycle is announced through a polite aria-live region; the ring is decorative and
// lives elsewhere, so the state a screen reader hears is this text.
import { CHECK_VERB, KEEP_VERB } from "./voteView";
import type { CheckVoteView } from "./useCheckVote";
import { VoteChips } from "./VoteChips";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

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

/** The verb pair. "Check it" is visually primary; both are substantial and keyboard-reachable. */
function Verbs({ view, size }: { view: CheckVoteView; size: "sm" | "xs" }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button
        variant="secondary"
        size={size}
        disabled={view.pending}
        onClick={view.onReject}
      >
        {KEEP_VERB}
      </Button>
      <Button
        variant="default"
        size={size}
        disabled={view.pending}
        onClick={view.onApprove}
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

function ProsceniumBar({ view }: { view: CheckVoteView }) {
  const open = view.phase === "open";
  return (
    <div className="vote-surface-enter hidden md:flex items-center gap-3 px-4 py-1.5 border-b border-dashed border-border-dashed bg-panel">
      {open ? (
        <>
          <ProposerAvatar view={view} />
          <span className="shrink-0 truncate text-2 font-medium text-text max-w-[40%]">
            {view.proposalText}
          </span>
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
    <div className="vote-surface-enter md:hidden flex items-center gap-2 px-3 py-1.5 border-b border-dashed border-border-dashed bg-panel">
      {open ? (
        <>
          <span className="min-w-0 flex-1 truncate text-1 font-medium text-text">
            {view.proposalText}
          </span>
          <div className="shrink-0">
            <VoteChips chips={view.chips} />
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
