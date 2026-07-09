// The on-screen keyboard, mobile's input surface (the grid is a div, not a native input, so no
// system keyboard appears). Each key drives the same store action a hardware key would, through
// the shared keyEffect path, so the two input routes cannot drift. Hidden on desktop, where the
// hardware keyboard and the clue rail take over. Keys meet the 44px touch-target floor.
import { cx } from "./primitives";

const ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"] as const;

/** Backspace glyph, drawn inline (Radix ships no backspace icon), tinted to the current text. */
function BackspaceGlyph() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M17 9.5 12.5 14M12.5 9.5 17 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Keyboard({
  onKey,
  disabled = false,
}: {
  /** Receives a single key: an uppercase letter, or "Backspace". */
  onKey: (key: string) => void;
  disabled?: boolean;
}) {
  const keyClass = cx(
    "flex-1 min-w-0 h-11 rounded-3 bg-panel border border-border shadow-sm",
    "font-sans text-4 text-text select-none",
    "active:bg-sand-4 transition-colors disabled:opacity-40",
  );

  return (
    <div
      className="md:hidden flex flex-col gap-1.5 px-1.5 pt-2 pb-[max(env(safe-area-inset-bottom),8px)] bg-background border-t border-border"
      aria-label="On-screen keyboard"
    >
      {ROWS.map((row, i) => (
        <div key={row} className="flex gap-1.5 justify-center">
          {i === 2 && <span className="w-4 shrink-0" aria-hidden />}
          {row.split("").map((letter) => (
            <button
              key={letter}
              type="button"
              disabled={disabled}
              onClick={() => onKey(letter)}
              className={keyClass}
            >
              {letter}
            </button>
          ))}
          {i === 2 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onKey("Backspace")}
              aria-label="Backspace"
              className={cx(
                keyClass,
                "flex items-center justify-center grow-[1.6]",
              )}
            >
              <BackspaceGlyph />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
