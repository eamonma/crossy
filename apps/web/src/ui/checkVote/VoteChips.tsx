// The elector chips (the UX spec, beats 2-3): the room reads faces, not numbers. Reuses the identity
// avatars and colors the roster paints. A not-yet-voted chip is dimmed; a settled chip carries a
// small side marker and plays a tick (keyed by userId+side so the settle remounts and animates once).
// The proposer's chip is pre-settled to the check side from the start (their proposal is their
// approval). No count is ever rendered here.
//
// Density (U8 mobile; Wave 15.7): the desktop Proscenium is uncapped and shows every face; the mobile
// strip passes `max` so the row collapses to an overlapping avatar stack plus a "+N" bubble beyond
// the cap, which keeps the verbs reachable on a 390px screen. No tally is ever exposed; "+N" is only
// how many faces are folded, not a vote count.
import { CheckIcon, Cross2Icon } from "@radix-ui/react-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ElectorChip } from "./voteView";

function Chip({ chip }: { chip: ElectorChip }) {
  return (
    <li
      className="relative leading-none"
      title={chip.isProposer ? `${chip.name} (proposed)` : chip.name}
    >
      <span
        className={`vote-chip inline-block rounded-full ${
          chip.side === "undecided"
            ? "vote-chip--undecided"
            : "vote-chip--settling"
        }`}
      >
        <Avatar
          size="sm"
          className="ring-2 ring-panel"
          style={
            chip.side === "check"
              ? { boxShadow: "0 0 0 2px var(--color-gold-9)" }
              : undefined
          }
        >
          {chip.avatarUrl !== null && (
            <AvatarImage src={chip.avatarUrl} alt="" />
          )}
          <AvatarFallback
            style={{ backgroundColor: chip.color, color: "#fff" }}
          >
            {chip.initial}
          </AvatarFallback>
        </Avatar>
      </span>
      {/* The side marker: a check for an approval, a cross for a keep-solving ballot. Undecided
          chips carry none. Anchored bottom-right, clear of the avatar's face. The ring-panel outline
          keeps the keep-side dot legible on a dark panel (dark dot on dark; Wave 15.7 dark theme). */}
      {chip.side !== "undecided" && (
        <span
          aria-hidden
          className={`absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full ring-1 ring-panel ${
            chip.side === "check"
              ? "bg-gold-9 text-white"
              : "bg-sand-6 text-sand-12"
          }`}
        >
          {chip.side === "check" ? (
            <CheckIcon className="h-2 w-2" />
          ) : (
            <Cross2Icon className="h-2 w-2" />
          )}
        </span>
      )}
    </li>
  );
}

export function VoteChips({
  chips,
  max,
}: {
  chips: readonly ElectorChip[];
  /** Cap the visible faces (the mobile strip). Beyond it the row folds to a stack plus a "+N"
   * bubble. Omitted on desktop, where every chip shows. */
  max?: number;
}) {
  const collapse = max !== undefined && chips.length > max;
  // Keep max-1 faces so the "+N" bubble occupies the last slot; N counts every folded face.
  const shown = collapse ? chips.slice(0, Math.max(0, max - 1)) : chips;
  const hidden = chips.length - shown.length;

  return (
    <ul
      className={`flex items-center m-0 p-0 list-none ${collapse ? "-space-x-1.5" : "gap-1.5"}`}
    >
      {shown.map((chip) => (
        <Chip key={`${chip.userId}-${chip.side}`} chip={chip} />
      ))}
      {collapse && hidden > 0 && (
        <li className="relative leading-none" title={`${hidden} more`}>
          <span className="inline-flex size-[1.5rem] items-center justify-center rounded-full bg-sand-4 text-1 font-semibold tabular-nums text-text-muted ring-2 ring-panel">
            +{hidden}
          </span>
        </li>
      )}
    </ul>
  );
}
