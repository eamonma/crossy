import { useEffect, useRef, useState } from "react";

// Recovery from an edge proxy cycle measures ~200ms end to end, so a 2s threshold hides those
// cycles and still surfaces a real outage.
export const RECONNECT_OVERLAY_GRACE_MS = 2000;

export interface DelayedFlag {
  /** Feed the current active state: false hides at once, true arms the grace timer. */
  set(active: boolean): void;
  /** Cancel a pending timer (teardown). */
  dispose(): void;
}

/**
 * The framework-free timer engine behind `useDelayedFlag`, split out so it is testable with vitest
 * fake timers (the ReactionModel idiom; the node test env mounts no React). `onChange` fires only on
 * a real transition of the emitted flag. One timer spans an unbroken active stretch: `set(true)`
 * while already active does not restart it, so an input that switches between two active values
 * without going inactive keeps the same grace window.
 */
export function createDelayedFlag(
  delayMs: number,
  onChange: (value: boolean) => void,
): DelayedFlag {
  let active = false;
  let value = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function emit(next: boolean): void {
    if (next === value) return;
    value = next;
    onChange(value);
  }

  function clear(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  return {
    set(next: boolean): void {
      if (next === active) return;
      active = next;
      if (!active) {
        clear();
        emit(false);
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        emit(true);
      }, delayMs);
    },
    dispose(): void {
      clear();
      active = false;
      value = false;
    },
  };
}

/**
 * True only after `active` has held continuously for `delayMs`, and false the moment `active` clears.
 * Presentation only: it delays a render, never a store transition. Callers collapse the two non-live
 * sync states to a single `active` boolean before this hook, so a resyncing <-> reconnecting bounce
 * leaves `active` unchanged and shares one grace timer.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  const flagRef = useRef<DelayedFlag | null>(null);
  if (flagRef.current === null) {
    flagRef.current = createDelayedFlag(delayMs, setShown);
  }
  useEffect(() => {
    flagRef.current?.set(active);
  }, [active]);
  useEffect(() => () => flagRef.current?.dispose(), []);
  return shown;
}
