// The persistent mini-tray (Wave 7.3). It reads as a small set of rubber stamps set beside the
// puzzle, not a chat feature: a quiet sand strip of the five send-set emoji, each a stamp you press
// to react at your current cell. It teaches its own shortcuts without shouting: the `/` leader hint
// leads the strip, and the two direct-key slots (🎉, 🤔) wear their `!` and `?` keycaps. The strip
// is the single source's view, so a change to REACTION_SET reshapes it with no edit here.
import { REACTION_SET } from "./reactionSet";
import { Keycap } from "./Keycap";
import { cn } from "@/lib/utils";

export function ReactionTray({
  onReact,
  disabled = false,
  className,
}: {
  /** Fire the emoji at the caller's current cursor cell (rate-capped inside the model). */
  onReact: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-3 border border-border bg-panel px-1.5 py-1 shadow-sm",
        disabled && "opacity-45",
        className,
      )}
      aria-label="Send a reaction"
    >
      {/* The leader hint: the `/` keycap that opens the radial HUD, set off by a hairline rule so it
          reads as a legend for the strip, not a sixth stamp. */}
      <span
        className="flex items-center gap-1 pr-1"
        title="Press / for the reaction ring"
      >
        <Keycap>/</Keycap>
      </span>
      <span aria-hidden className="mr-0.5 h-4 w-px bg-border" />
      {REACTION_SET.map((option) => (
        <button
          key={option.emoji}
          type="button"
          disabled={disabled}
          // Keep the board focused so the keyboard paths keep working after a click: preventing the
          // mousedown default stops the button stealing focus, while the click still fires.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onReact(option.emoji)}
          className={cn(
            "reaction-stamp relative flex items-center justify-center rounded-2",
            "leading-none transition-[transform,background-color] duration-100 ease-[var(--ease-out)]",
            "hover:bg-sand-3 active:scale-90 disabled:pointer-events-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
          )}
          style={{ width: "2rem", height: "2rem", fontSize: "1.15rem" }}
          aria-label={`React with ${option.emoji}`}
        >
          <span aria-hidden>{option.emoji}</span>
          {option.directKey !== undefined && (
            // The direct-key hint rides the stamp's lower-right corner, a keycap the size of the
            // presence pucks so it never competes with the emoji it annotates.
            <span className="pointer-events-none absolute -bottom-1 -right-1">
              <Keycap>{option.directKey}</Keycap>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
