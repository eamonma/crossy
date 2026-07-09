// The room's shared timer, derived only (DESIGN section 2, D15): it starts at the first fill
// event and freezes at completion, both server-timestamped. The client owns no clock; this hook
// just renders elapsed wall time between those two facts and ticks once a second while the game
// is ongoing. Displayed with tabular numerals so the digits never jitter.
import { useEffect, useState } from "react";

/** Whole seconds between two ISO instants, floored, never negative. */
function secondsBetween(startIso: string, endMs: number): number {
  const start = Date.parse(startIso);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((endMs - start) / 1000));
}

/** mm:ss, or h:mm:ss past an hour. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/**
 * Elapsed seconds for the display timer. Before the first fill it reads 0. While ongoing it
 * ticks off wall time since firstFillAt. Once completedAt lands it freezes at that exact span,
 * so every client shows the same final time regardless of when it stopped ticking.
 */
export function useElapsedSeconds(
  firstFillAt: string | null,
  completedAt: string | null,
): number {
  const frozen = completedAt !== null && firstFillAt !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (frozen || firstFillAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [frozen, firstFillAt]);

  if (firstFillAt === null) return 0;
  if (completedAt !== null)
    return secondsBetween(firstFillAt, Date.parse(completedAt));
  return secondsBetween(firstFillAt, now);
}
