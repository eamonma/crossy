// The share page shell and its replay schedule (design/post-game/SHARE.md wave S3; PROTOCOL.md §12
// GET /s/{token}). No Docker, no jsdom: the shell is a pure function of the assembly, so these
// drive it directly. They defend the motion contract (the loop's partition, the linear compression,
// the stall clamp), the reduced-motion gate (every animation rule lives inside the no-preference
// media block), the sequence-order reveal (parsed from the emitted keyframes, numerically), the
// solo gold ramp, both grounds, and INV-6 (nothing letter-shaped exists on the page's board).
import { describe, expect, it } from "vitest";
import { BRAND, OWNER_TINT, mixHex, soloRampColor } from "@crossy/share-card";
import type { ShareCardData } from "@crossy/share-card";
import type { ShareAssembly } from "./cardData";
import {
  FADE_SECONDS,
  HOLD_SECONDS,
  LEAD_SECONDS,
  LOOP_SECONDS,
  REVEAL_SECONDS,
  STALL_CAP_SECONDS,
  revealDelays,
  revealGroups,
  shareShell,
} from "./shell";

/** A 2x2 all-open two-solver mini, sequence with real (uneven) relative timing. */
function assembly(): ShareAssembly {
  const card: ShareCardData = {
    rows: 2,
    cols: 2,
    blocks: [],
    ownersByCell: { 0: 0, 1: 0, 2: 1, 3: 1 },
    solvers: [
      { name: "Ada", colorLight: "#6F66D4", colorDark: "#9D95FF" },
      { name: "Grace", colorLight: "#DE5722", colorDark: "#FF7A50" },
    ],
    stats: {
      activeSeconds: 20,
      sittingCount: 1,
      solverCount: 2,
      squareCount: 4,
    },
    puzzle: { title: "Mini", author: null },
    solvedOn: "Jul 17, 2026",
  };
  return {
    card,
    sequence: [
      { cell: 0, atSeconds: 0 },
      { cell: 1, atSeconds: 5 },
      { cell: 2, atSeconds: 10 },
      { cell: 3, atSeconds: 20 },
    ],
    solo: false,
  };
}

function soloAssembly(): ShareAssembly {
  const base = assembly();
  return {
    card: {
      ...base.card,
      ownersByCell: { 0: 0, 1: 0, 2: 0, 3: 0 },
      fillOrderByCell: { 0: 0, 1: 1 / 3, 2: 2 / 3, 3: 1 },
      solvers: [base.card.solvers[0]!],
      stats: { ...base.card.stats, solverCount: 1 },
    },
    sequence: base.sequence,
    solo: true,
  };
}

function shellOf(a: ShareAssembly): string {
  return shareShell({
    title: a.card.puzzle.title ?? "Crossy",
    cardUrl: "https://crossy.ing/s/AAAA/card.png",
    appOrigin: "https://crossy.party",
    assembly: a,
  });
}

/** Extract the reduced-motion media block's body via brace matching, plus the rest of the page. */
function splitMotionBlock(html: string): { inside: string; outside: string } {
  const marker = "@media (prefers-reduced-motion: no-preference){";
  const start = html.indexOf(marker);
  expect(start, "the no-preference media block exists").toBeGreaterThan(-1);
  let depth = 1;
  let i = start + marker.length;
  while (depth > 0 && i < html.length) {
    if (html[i] === "{") depth += 1;
    if (html[i] === "}") depth -= 1;
    i += 1;
  }
  expect(depth).toBe(0);
  return {
    inside: html.slice(start + marker.length, i - 1),
    outside: html.slice(0, start) + html.slice(i),
  };
}

/** The reveal start second per cell, parsed from the emitted markup: the cell rect's group class,
 * then that group's keyframes first stop, converted back to seconds of the loop. */
function parsedRevealSeconds(html: string, cell: number): number {
  const rect = new RegExp(
    `<rect data-cell="${cell}" [^>]*class="rv (k\\d+)"/>`,
  ).exec(html);
  expect(rect, `cell ${cell} carries a reveal group`).not.toBeNull();
  const frames = new RegExp(
    `@keyframes ${rect![1]}\\{0%,([\\d.]+)%\\{opacity:0`,
  ).exec(html);
  expect(frames, `keyframes for ${rect![1]} exist`).not.toBeNull();
  return (Number(frames![1]) / 100) * LOOP_SECONDS;
}

describe("the replay schedule (SHARE.md S3 motion contract)", () => {
  it("the loop partitions exactly: lead + reveal + hold + fade = the loop", () => {
    expect(LEAD_SECONDS + REVEAL_SECONDS + HOLD_SECONDS + FADE_SECONDS).toBe(
      LOOP_SECONDS,
    );
  });

  it("compresses real relative timing linearly onto the reveal window (bursts stay bursts, stalls stay beats)", () => {
    const delays = revealDelays(assembly().sequence);
    expect(delays[0]).toBeCloseTo(LEAD_SECONDS, 10);
    expect(delays[3]).toBeCloseTo(LEAD_SECONDS + REVEAL_SECONDS, 10);
    // Linear: 5 of 20 raw seconds is a quarter of the window; 10 is half.
    expect(delays[1]).toBeCloseTo(LEAD_SECONDS + REVEAL_SECONDS / 4, 10);
    expect(delays[2]).toBeCloseTo(LEAD_SECONDS + REVEAL_SECONDS / 2, 10);
    // Monotone nondecreasing, always.
    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]!).toBeGreaterThanOrEqual(delays[i - 1]!);
    }
  });

  it("clamps a single stall at the cap so one stare cannot flatten the rest into a blur", () => {
    const sequence = [
      { cell: 0, atSeconds: 0 },
      { cell: 1, atSeconds: 1 },
      { cell: 2, atSeconds: 2 },
      { cell: 3, atSeconds: 2 + 3600 }, // an hour-long active stall
      { cell: 4, atSeconds: 3 + 3600 },
    ];
    const delays = revealDelays(sequence);
    const clampedSpan = 1 + 1 + STALL_CAP_SECONDS + 1;
    // The stall reads as the maximum beat, no longer.
    expect(delays[3]! - delays[2]!).toBeCloseTo(
      (STALL_CAP_SECONDS / clampedSpan) * REVEAL_SECONDS,
      10,
    );
    // The 1-second fills around it stay visible beats, not sub-frame dust.
    expect(delays[1]! - delays[0]!).toBeCloseTo(
      (1 / clampedSpan) * REVEAL_SECONDS,
      10,
    );
    expect(delays[4]).toBeCloseTo(LEAD_SECONDS + REVEAL_SECONDS, 10);
  });

  it("a zero-span or single-step sequence lands wholly at the lead beat", () => {
    expect(revealDelays([{ cell: 3, atSeconds: 42 }])).toEqual([LEAD_SECONDS]);
    expect(
      revealDelays([
        { cell: 0, atSeconds: 7 },
        { cell: 1, atSeconds: 7 },
      ]),
    ).toEqual([LEAD_SECONDS, LEAD_SECONDS]);
    expect(revealDelays([])).toEqual([]);
  });

  it("same-instant fills share one keyframes group; groups ascend and cover every step", () => {
    const groups = revealGroups([
      { cell: 0, atSeconds: 0 },
      { cell: 1, atSeconds: 10 },
      { cell: 2, atSeconds: 10 },
      { cell: 3, atSeconds: 20 },
    ]);
    expect(groups.map((g) => g.cells)).toEqual([[0], [1, 2], [3]]);
    expect(groups.map((g) => g.name)).toEqual(["k0", "k1", "k2"]);
    for (let i = 1; i < groups.length; i += 1) {
      expect(groups[i]!.startPct).toBeGreaterThan(groups[i - 1]!.startPct);
    }
  });
});

describe("the share shell (PROTOCOL.md §12 GET /s/{token}; SHARE.md S3)", () => {
  it("keeps EVERY animation rule inside the prefers-reduced-motion: no-preference block (reduced motion gets the finished static board)", () => {
    const { inside, outside } = splitMotionBlock(shellOf(assembly()));
    expect(inside).toContain("@keyframes");
    expect(inside).toContain("animation:");
    expect(outside).not.toContain("@keyframes");
    expect(outside).not.toContain("animation");
  });

  it("reveals in sequence order: the emitted keyframe delays are monotone against the bundle and span exactly the reveal window", () => {
    const html = shellOf(assembly());
    const seconds = [0, 1, 2, 3].map((cell) => parsedRevealSeconds(html, cell));
    for (let i = 1; i < seconds.length; i += 1) {
      expect(seconds[i]!).toBeGreaterThan(seconds[i - 1]!);
    }
    // Numeric scale check: first at the lead beat, last at the window's close (2-decimal
    // percentage quantization, so within a hundredth of the loop).
    expect(seconds[0]!).toBeCloseTo(LEAD_SECONDS, 2);
    expect(seconds[3]!).toBeCloseTo(LEAD_SECONDS + REVEAL_SECONDS, 2);
  });

  it("a solo assembly paints the gold ramp, never a roster wash (SHARE.md solo rule)", () => {
    const html = shellOf(soloAssembly());
    expect(html).toContain(soloRampColor(1, "light")); // the last square lands on brand gold
    expect(html).toContain(soloRampColor(1, "dark"));
    expect(html).not.toContain(mixHex(BRAND.studio, "#6F66D4", OWNER_TINT));
  });

  it("styles both grounds: Studio by default, Observatory + the dark board under prefers-color-scheme: dark", () => {
    const html = shellOf(assembly());
    expect(html).toContain('class="g-light"');
    expect(html).toContain('class="g-dark"');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain(BRAND.studio);
    expect(html).toContain(BRAND.observatory);
    // Each ground's board wears its own roster pairing.
    expect(html).toContain(mixHex(BRAND.studio, "#6F66D4", OWNER_TINT));
    expect(html).toContain(mixHex(BRAND.observatory, "#9D95FF", OWNER_TINT));
  });

  it("INV-6: the page is built from cells, seconds, and display metadata only; the board draws no text nodes and no script or img rides along", () => {
    const a = assembly();
    // The input shape has no field a board letter could ride (a leak is a compile error).
    for (const forbidden of ["solution", "grid", "answers", "letters"]) {
      expect(Object.keys(a.card)).not.toContain(forbidden);
      for (const step of a.sequence) {
        expect(Object.keys(step)).toEqual(["cell", "atSeconds"]);
      }
    }
    const html = shellOf(a);
    expect(html).not.toContain("<text");
    expect(html).not.toContain("<script");
    // The hero is the inline SVG itself: statically the finished mosaic, so it is never empty
    // and needs no img fallback; og:image (the PNG) remains for unfurlers.
    expect(html).not.toContain("<img");
    expect(html).toContain('property="og:image"');
  });

  it("escapes a hostile title everywhere it renders (title tag, og tags, heading, aria-label)", () => {
    const a = assembly();
    const html = shareShell({
      title: `A&W <Special> "quoted"`,
      cardUrl: "https://crossy.ing/s/AAAA/card.png",
      appOrigin: "https://crossy.party",
      assembly: a,
    });
    expect(html).not.toContain("<Special>");
    expect(html).toContain("A&amp;W &lt;Special&gt;");
  });

  it("an empty sequence ships a static shell: no motion block at all, hero still the finished board", () => {
    const a = { ...assembly(), sequence: [] };
    const html = shellOf(a);
    expect(html).not.toContain("@keyframes");
    expect(html).not.toContain("prefers-reduced-motion");
    expect(html).toContain(mixHex(BRAND.studio, "#6F66D4", OWNER_TINT));
  });
});
