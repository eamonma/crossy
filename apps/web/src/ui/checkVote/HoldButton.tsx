// Hold-to-propose (the UX spec, beat 1): in a multiplayer room the Check control is press-and-hold,
// not a confirm dialog. A ~600 ms hold with a fill animation completes the intent; releasing early
// cancels cleanly. The hold works by pointer (mouse and touch) AND by keyboard (hold Enter or Space
// on the focused button), and it says so, so the affordance is discoverable without sight of the
// fill. Focus is never taken by anyone else; this is an ordinary focusable button.
import { useCallback, useEffect, useRef, useState } from "react";

const HOLD_MS = 600;

export function HoldButton({
  onComplete,
  disabled = false,
  label,
  className = "",
  holdMs = HOLD_MS,
}: {
  onComplete: () => void;
  disabled?: boolean;
  /** The resting label; the accessible name adds the hold instruction. */
  label: string;
  className?: string;
  holdMs?: number;
}) {
  const [holding, setHolding] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (disabled || timerRef.current !== null) return;
    completedRef.current = false;
    setHolding(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      completedRef.current = true;
      setHolding(false);
      onComplete();
    }, holdMs);
  }, [disabled, holdMs, onComplete]);

  const cancel = useCallback(() => {
    clear();
    setHolding(false);
  }, [clear]);

  useEffect(() => clear, [clear]);

  return (
    <button
      type="button"
      disabled={disabled}
      data-holding={holding ? "true" : "false"}
      aria-keyshortcuts="Enter Space"
      aria-label={`${label}. Press and hold to propose a check for the room.`}
      title="Press and hold to propose a check"
      className={`hold-btn relative isolate inline-flex h-[1.75rem] items-center justify-center overflow-hidden rounded-3 border border-border bg-secondary px-3 text-1 font-medium text-text disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      style={{ ["--hold-ms" as string]: `${holdMs}ms` }}
      onPointerDown={(e) => {
        // Primary button / touch only; keep the press even if the pointer wanders a little.
        if (e.button !== 0 && e.pointerType === "mouse") return;
        start();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault(); // Space would scroll; Enter would fire a click
        if (e.repeat) return;
        start();
      }}
      onKeyUp={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        // The timer owns completion; a release before it fires cancels.
        if (!completedRef.current) cancel();
      }}
      onBlur={cancel}
    >
      {/* The fill sweeps left-to-right over the hold window; it is the affordance, so it stays under
          reduced motion (styles.css keeps the transition, just linear). Behind the label (-z). */}
      <span
        aria-hidden
        className="hold-fill absolute inset-0 -z-10 bg-gold-5"
      />
      {label}
    </button>
  );
}
