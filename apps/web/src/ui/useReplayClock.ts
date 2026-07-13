// The post-game replay's one clock, lifted to LiveGame so the momentum ribbon (the playhead) and the
// mosaic (the time-gated reveal) move together on a single time value (REPLAY.md: "one clock, two
// views"). `time` is a relative second into the solve, or null for "not replaying" so the board rests
// on the full settled mosaic. Playback is compressed real time: the head sweeps [0, durationSeconds]
// at constant speed over a fixed PLAYBACK_MS window, so a stall reads as dead air and a burst as a
// flurry (never one-cell-per-tick). No speed control; the scrub covers everything else.
//
// This is browser app code, not the engine, so performance.now()/requestAnimationFrame are fine here.
import { useCallback, useEffect, useRef, useState } from "react";

/** The fixed sweep length: the whole solve compressed to this window regardless of its real duration
 * (REPLAY.md: "fixed length plus manual scrub"). ~8s reads as a replay, not a second bloom. */
export const PLAYBACK_MS = 8000;

export interface ReplayClock {
  /** The current head in relative seconds, or null when not replaying (board rests on the full wash). */
  readonly time: number | null;
  readonly playing: boolean;
  /** Play/pause. From a paused or scrubbed head it resumes there; from the end (or null) it restarts. */
  toggle(): void;
  /** Pause and jump the head to `t`, clamped to [0, durationSeconds]. The scrub's entry point. */
  seek(t: number): void;
  /** Leave replay: time -> null, playing -> false, so the board settles back to the full mosaic. */
  reset(): void;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The replay clock for a solve of `durationSeconds`. Degenerate (`durationSeconds <= 0`) makes the
 * clock inert: toggle and seek no-op, so a single-instant solve (which hides the transport anyway)
 * can never start an empty sweep. Under prefers-reduced-motion, toggle does not animate: it settles
 * to the full board rather than run a rAF sweep, while manual seek scrubbing stays available (a
 * reduced-motion user can still drag the playhead through the solve, just not watch it auto-play).
 */
export function useReplayClock(durationSeconds: number): ReplayClock {
  const [time, setTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  // The live head and the rAF handle live in refs so the animation loop reads the latest without
  // re-subscribing each frame, and cleanup can cancel a pending frame on unmount or reset.
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const fromRef = useRef(0);
  const durationRef = useRef(durationSeconds);
  durationRef.current = durationSeconds;

  // A ref mirror of the head, so toggle() reads the latest without a setState updater. Scheduling the
  // rAF sweep inside a setTime updater would double-fire under StrictMode (updaters must be pure);
  // every write to `time` goes through setHead so the ref and the state never drift.
  const timeRef = useRef<number | null>(null);
  const setHead = useCallback((t: number | null): void => {
    timeRef.current = t;
    setTime(t);
  }, []);

  const cancelRaf = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const reset = useCallback((): void => {
    cancelRaf();
    setPlaying(false);
    setHead(null);
  }, [cancelRaf, setHead]);

  const seek = useCallback(
    (t: number): void => {
      const dur = durationRef.current;
      if (dur <= 0) return;
      cancelRaf();
      setPlaying(false);
      setHead(Math.max(0, Math.min(dur, t)));
    },
    [cancelRaf, setHead],
  );

  const toggle = useCallback((): void => {
    const dur = durationRef.current;
    if (dur <= 0) return;

    // Pause: keep the head where it is, stop advancing it.
    if (rafRef.current !== null) {
      cancelRaf();
      setPlaying(false);
      return;
    }

    // Start from the current head, unless it is null (fresh) or at the end (a finished sweep): those
    // restart from 0 so pressing play again replays from the top rather than sitting stuck at the end.
    const current = timeRef.current;
    const atEnd = current !== null && current >= dur;
    const from = current === null || atEnd ? 0 : current;

    // Reduced motion: do not run an animation. Settle straight to the full board (REPLAY.md: a
    // reduced-motion user gets the resting state, not a sweep) and leave scrubbing available.
    if (prefersReducedMotion()) {
      reset();
      return;
    }

    fromRef.current = from;
    startRef.current = performance.now();
    setHead(from);
    setPlaying(true);

    const step = (now: number): void => {
      const d = durationRef.current;
      if (d <= 0) {
        reset();
        return;
      }
      const elapsedMs = now - startRef.current;
      // The whole solve maps onto PLAYBACK_MS: t = from + (elapsed / PLAYBACK_MS) * duration.
      const t = fromRef.current + (elapsedMs / PLAYBACK_MS) * d;
      if (t >= d) {
        // Reached the end: settle back to the full board (null), never leave a frozen head.
        reset();
        return;
      }
      setHead(t);
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [cancelRaf, reset, setHead]);

  // Cancel any in-flight frame when the component unmounts (or the hook is torn down).
  useEffect(() => cancelRaf, [cancelRaf]);

  return { time, playing, toggle, seek, reset };
}
