// Text plumbing for a renderer that cannot measure text: XML escaping, code-point
// truncation against the layout's grapheme budgets (SHARE.md documents the budgets),
// and the clock format the app's stat rows already speak.

/** Escape a display string for SVG text content and attribute values. Every caller-
 * supplied string passes through here exactly once, so no data can break out of its
 * text node (the no-letters test rides on this being airtight). */
export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Truncate to `budget` code points with a single ellipsis. Code points, not UTF-16
 * units, so an astral-plane character is never split; grapheme clusters can still
 * theoretically break (no segmenter without an import), which the budgets absorb by
 * being conservative. A string at or under budget passes through verbatim.
 */
export function truncate(s: string, budget: number): string {
  const points = Array.from(s);
  if (points.length <= budget) return s;
  return points.slice(0, Math.max(0, budget - 1)).join("") + "…";
}

/**
 * M:SS, or H:MM:SS past an hour: whole seconds, zero-padded, never negative, never
 * NaN, digit-for-digit the app's formatDuration/formatMSS so the card and the panel
 * can never disagree on the same number.
 */
export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const s = Math.max(0, Math.floor(safe));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
