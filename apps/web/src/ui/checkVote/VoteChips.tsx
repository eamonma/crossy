// The elector chips (the UX spec, beats 2-3): the room reads faces, not numbers. Reuses the identity
// avatars and colors the roster paints. A not-yet-voted chip is dimmed; a settled chip carries a
// small side marker and plays a tick (keyed by userId+side so the settle remounts and animates once).
// The proposer's chip is pre-settled to the check side from the start (their proposal is their
// approval). No count is ever rendered here.
import { CheckIcon, Cross2Icon } from "@radix-ui/react-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ElectorChip } from "./voteView";

export function VoteChips({ chips }: { chips: readonly ElectorChip[] }) {
  return (
    <ul className="flex items-center gap-1.5 m-0 p-0 list-none">
      {chips.map((chip) => (
        <li
          key={`${chip.userId}-${chip.side}`}
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
              chips carry none. Anchored bottom-right, clear of the avatar's face. */}
          {chip.side !== "undecided" && (
            <span
              aria-hidden
              className={`absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full ${
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
      ))}
    </ul>
  );
}
