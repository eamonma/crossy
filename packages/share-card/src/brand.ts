// The Crossy identity, embedded as data so the card needs no font and no asset fetch.
//
// SOURCE OF TRUTH: docs/design/logo/generate.py. The mark geometry and the wordmark
// outlines below are copied VERBATIM from its emitted SVGs (mark-light.svg,
// mark-dark.svg, wordmark-light.svg); edit the generator, regenerate, and re-copy —
// never hand-edit these numbers. The wordmark is Crossy in Harfang Pro outlined to
// paths (docs/design/logo/wordmark_data.py), because the brand serif may not be loaded
// wherever a card lands; outlines make the lockup render-stable everywhere.

/** The brand tokens, verbatim (docs/design/logo/README.md). */
export const BRAND = {
  ink: "#1D1B18",
  bone: "#EDEAE2",
  gold: "#978365",
  /** Studio ground: the light card face. */
  studio: "#F2F1EC",
  /** Observatory ground: the dark card face. */
  observatory: "#121118",
} as const;

/** The lockup band: mark 24, gap 6, wordmark 53.0415 wide, all 24 tall
 * (docs/design/logo/README.md "The lockup recipe"). */
export const LOCKUP_BAND = { mark: 24, gap: 6, word: 53.0415, height: 24 };

/** Total lockup width at band scale 1. */
export const LOCKUP_WIDTH =
  LOCKUP_BAND.mark + LOCKUP_BAND.gap + LOCKUP_BAND.word;

// Crossy, Harfang Bold outlined; GPOS-kerned, tracked -0.00625em. Authored in the
// lockup band: 24 tall, baseline 18.048. Emitted by generate.py; copied verbatim.
const WORDMARK_GLYPHS: readonly { x: number; d: string }[] = [
  {
    x: 0,
    d: "M596 127C516 90 468 68 410 68C275 68 180 179 180 372C180 549 243 639 355 639C407 639 459 618 511 578L548 473L596 483V643C533 681 462 700 392 700C206 700 30 568 30 328C30 108 182 -12 355 -12C446 -12 531 28 621 82Z",
  },
  {
    x: 11.1195,
    d: "M314 0 320 46 245 60C232 63 227 68 227 79V385L305 420C321 413 336 400 336 373V346H376C417 346 450 372 450 418C450 474 400 497 355 497C346 497 336 496 327 493L227 427V497L22 475L25 430L100 414V61L29 46L24 0Z",
  },
  {
    x: 18.945,
    d: "M278 31C185 31 152 198 152 277C152 343 174 451 255 451C349 451 381 283 381 202C381 144 358 31 278 31ZM255 -12C382 -12 510 94 510 254C510 400 428 497 278 497C151 497 23 391 23 231C23 85 105 -12 255 -12Z",
  },
  {
    x: 28.6065,
    d: "M357 348 362 464C322 487 279 497 234 497C136 497 46 447 46 344C46 201 290 194 290 90C290 49 256 34 220 34C183 34 141 53 109 85L87 176L45 171L40 39C80 5 142 -12 199 -12C298 -12 394 41 394 152C394 306 146 302 146 405C146 435 169 450 201 450C236 450 273 431 293 415L317 343Z",
  },
  {
    x: 36.162,
    d: "M357 348 362 464C322 487 279 497 234 497C136 497 46 447 46 344C46 201 290 194 290 90C290 49 256 34 220 34C183 34 141 53 109 85L87 176L45 171L40 39C80 5 142 -12 199 -12C298 -12 394 41 394 152C394 306 146 302 146 405C146 435 169 450 201 450C236 450 273 431 293 415L317 343Z",
  },
  {
    x: 43.1415,
    d: "M204 -158C192 -163 181 -166 170 -166C159 -166 147 -162 136 -155V-76H91C49 -76 25 -104 25 -141C25 -186 74 -214 131 -214C200 -214 258 -178 292 -90L491 425L538 437L545 485H355L347 438L403 425C410 423 413 419 413 412C413 408 411 400 408 392L319 141L196 425L263 438L269 485H14L4 437L50 423C59 420 64 414 68 405L263 0Z",
  },
];

/** The wordmark paths at band coordinates (24 tall, baseline 18.048), filled `fill`. */
function wordmarkSvg(fill: string): string {
  const paths = WORDMARK_GLYPHS.map(
    (g) =>
      `<path transform="translate(${g.x} 18.048) scale(0.018 -0.018)" d="${g.d}"/>`,
  ).join("");
  return `<g fill="${fill}">${paths}</g>`;
}

/** The 3x3 mark at band coordinates (24x24). Light: ink blocks and grid lines, gold Y
 * cell, open cells transparent (mark-light.svg). Dark: bone plates, gold Y cell, the
 * ground showing through as blocks and grid lines (mark-dark.svg). Copied verbatim. */
function markSvg(ground: "light" | "dark"): string {
  if (ground === "light") {
    return (
      `<rect y="16" width="8" height="8" fill="${BRAND.ink}"/>` +
      `<rect x="8" y="8" width="8" height="8" fill="${BRAND.ink}"/>` +
      `<rect x="16" width="8" height="8" fill="${BRAND.ink}"/>` +
      `<rect x="16" y="16" width="8" height="8" fill="${BRAND.gold}"/>` +
      `<path d="M8 0v24M16 0v24M0 8h24M0 16h24" stroke="${BRAND.ink}" stroke-width="1.25" fill="none"/>`
    );
  }
  return (
    `<rect width="7.375" height="7.375" fill="${BRAND.bone}"/>` +
    `<rect y="8.625" width="7.375" height="6.75" fill="${BRAND.bone}"/>` +
    `<rect x="8.625" width="6.75" height="7.375" fill="${BRAND.bone}"/>` +
    `<rect x="8.625" y="16.625" width="6.75" height="7.375" fill="${BRAND.bone}"/>` +
    `<rect x="16.625" y="8.625" width="7.375" height="6.75" fill="${BRAND.bone}"/>` +
    `<rect x="16.625" y="16.625" width="7.375" height="7.375" fill="${BRAND.gold}"/>`
  );
}

/**
 * The horizontal lockup (mark, gap, wordmark) placed at (x, y) with the mark `size`
 * tall. Returns the group plus its rendered width, so a caller can right-align
 * neighbors without measuring anything.
 */
export function lockupSvg(
  x: number,
  y: number,
  size: number,
  ground: "light" | "dark",
): { svg: string; width: number } {
  const s = size / LOCKUP_BAND.height;
  const wordFill = ground === "light" ? BRAND.ink : BRAND.bone;
  const svg =
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    markSvg(ground) +
    `<g transform="translate(${LOCKUP_BAND.mark + LOCKUP_BAND.gap} 0)">` +
    wordmarkSvg(wordFill) +
    `</g></g>`;
  return { svg, width: LOCKUP_WIDTH * s };
}
