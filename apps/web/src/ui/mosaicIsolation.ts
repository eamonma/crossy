// Solver isolation on the contribution mosaic (owner ruling, the Analysis legend): tapping a
// solver's legend row spotlights their squares. Their cells keep the full owner wash; every other
// tint dims toward the plain ground; ink letters stay untouched. Tapping the same row clears,
// tapping another row switches. Pure arithmetic only, kept out of the components so it is testable
// under the node vitest environment, the same split mosaicReveal.ts keeps.
//
// The dim is a fill-opacity MULTIPLIER over whatever opacity the mosaic has already painted
// (the settled wash, the bloom's field, or the replay's time-gated reveal). Two consequences,
// both load-bearing:
//   - the reveal arc is untouched: the bloom animates the rect's `opacity` channel imperatively
//     (the #204 discipline: the effect keys only on its trigger), while isolation rides the
//     independent `fill-opacity` channel through a plain React render. Toggling isolation repaints
//     tints in place and can never re-arm the sweep.
//   - replay composes for free: at replay time T the playhead decides WHICH cells show, and the
//     multiplier decides how strongly their tint reads, so isolating during a replay dims the
//     non-isolated revealed cells exactly as it dims the settled wash.
// Dimming is opacity toward the ground, never a substitute color, so it reads correctly on both
// the light and dark grounds (the wash colors come from the dual-ground identity roster).

/** The multiplier a non-isolated owner's tint drops to while a solver is isolated. Over the
 * settled WASH_ALPHA (0.3) this leaves a ~0.06 ghost of the tint: near the plain ground, but the
 * board's shape survives, so clearing isolation reads as the color coming back, not appearing. */
export const ISOLATION_DIM = 0.2;

/**
 * The fill multiplier for a cell's owner tint under isolation. No isolation (`isolatedId` null)
 * keeps every wash at full strength. With a solver isolated, only their cells stay full; every
 * other tint (another owner's, or an unowned cell's — which paints no rect anyway) dims toward
 * the ground. Pure: same input, same output.
 */
export function isolationAlpha(
  ownerId: string | undefined,
  isolatedId: string | null,
): number {
  if (isolatedId === null) return 1;
  return ownerId === isolatedId ? 1 : ISOLATION_DIM;
}

/**
 * The legend tap contract: tapping a row isolates that solver, tapping the same row again clears
 * isolation, tapping a different row switches to that solver. Self-isolation is just tapping your
 * own row; there is no separate mode.
 */
export function nextIsolation(
  current: string | null,
  tapped: string,
): string | null {
  return current === tapped ? null : tapped;
}
