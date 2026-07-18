// The completion card's contract (design/post-game/SHARE.md): the mask's geometry, the
// no-letters guarantee (INV-6 in spirit: the card spoils nothing), ground pairing, the
// solo ramp, and byte stability of a fixed fixture.
import { describe, expect, it } from "vitest";
import {
  completionBoardSvg,
  completionCardSvg,
  soloRampColor,
  BUDGETS,
  DARK_BOARD,
  LIGHT_BOARD,
  OWNER_TINT,
} from "./card";
import { BRAND } from "./brand";
import { mixHex, parseHex } from "./color";
import type { ShareCardData } from "./types";

/** A 5x5 room: two blocks, three solvers, every white cell owned. */
function fixture(): ShareCardData {
  const blocks = [4, 20];
  const ownersByCell: Record<number, number> = {};
  for (let cell = 0; cell < 25; cell += 1) {
    if (blocks.includes(cell)) continue;
    ownersByCell[cell] = cell % 3;
  }
  return {
    rows: 5,
    cols: 5,
    blocks,
    ownersByCell,
    solvers: [
      {
        name: "Ada",
        colorLight: "#6F66D4",
        colorDark: "#9D95FF",
        title: { label: "The workhorse", detail: "11 squares filled" },
      },
      {
        name: "Brin",
        colorLight: "#DE5722",
        colorDark: "#FF7A50",
        title: {
          label: "The closer",
          detail: "4 squares in the closing stretch",
        },
      },
      { name: "Cleo", colorLight: "#17917F", colorDark: "#3BC7B4" },
    ],
    stats: {
      activeSeconds: 754,
      sittingCount: 2,
      solverCount: 3,
      squareCount: 23,
    },
    puzzle: { title: "Saturday Stumper", author: "E. Longo" },
    solvedOn: "Jul 17, 2026",
  };
}

/** Every text run in the SVG (text and tspan content), XML-unescaped. */
function textRuns(svg: string): string[] {
  const runs: string[] = [];
  for (const m of svg.matchAll(/<(?:text|tspan)[^>]*>([^<]*)/g)) {
    const t = m[1]!.trim();
    if (t !== "") {
      runs.push(
        t
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&"),
      );
    }
  }
  return runs;
}

/** The board rect for a cell index: [x, y, fill]. */
function cellRect(
  svg: string,
  cell: number,
): { x: number; y: number; fill: string } {
  const m = new RegExp(
    `<rect data-cell="${cell}" x="([\\d.]+)" y="([\\d.]+)" width="[\\d.]+" height="[\\d.]+" fill="(#[0-9a-fA-F]{6})"/>`,
  ).exec(svg);
  expect(m, `cell ${cell} present`).not.toBeNull();
  return { x: Number(m![1]), y: Number(m![2]), fill: m![3]! };
}

describe("geometry: the mask decides the board (SHARE.md layout contract)", () => {
  it("portrait is 1080x1620 and og is 1200x630, viewBox included", () => {
    const d = fixture();
    const portrait = completionCardSvg(d, {
      ground: "light",
      variant: "portrait",
    });
    expect(portrait.width).toBe(1080);
    expect(portrait.height).toBe(1620);
    expect(portrait.svg).toContain('viewBox="0 0 1080 1620"');
    const og = completionCardSvg(d, { ground: "light", variant: "og" });
    expect(og.width).toBe(1200);
    expect(og.height).toBe(630);
    expect(og.svg).toContain('viewBox="0 0 1200 630"');
  });

  it("draws every cell once, blocks in the game's cell-block tone, white cells washed (both variants)", () => {
    const d = fixture();
    for (const variant of ["portrait", "og"] as const) {
      const { svg } = completionCardSvg(d, { ground: "light", variant });
      expect(svg.match(/data-cell="/g)?.length).toBe(25);
      expect(cellRect(svg, 4).fill).toBe(LIGHT_BOARD.block);
      expect(cellRect(svg, 20).fill).toBe(LIGHT_BOARD.block);
      expect(cellRect(svg, 0).fill).not.toBe(LIGHT_BOARD.block);
    }
  });

  it("places cells row-major: cell 7 sits one row down, two columns across from cell 0", () => {
    const d = fixture();
    const { svg } = completionCardSvg(d, {
      ground: "light",
      variant: "portrait",
    });
    const c0 = cellRect(svg, 0);
    const c1 = cellRect(svg, 1);
    const c7 = cellRect(svg, 7);
    const cell = c1.x - c0.x;
    expect(cell).toBeGreaterThan(0);
    expect(c7.x - c0.x).toBe(2 * cell);
    expect(c7.y - c0.y).toBe(cell);
  });

  it("the board has no rounded corners: no rx anywhere on a board cell", () => {
    const d = fixture();
    const { svg } = completionCardSvg(d, {
      ground: "light",
      variant: "portrait",
    });
    expect(svg).not.toMatch(/data-cell="\d+"[^/]*rx=/);
  });
});

describe("the no-letters guarantee (INV-6 in spirit: the card spoils nothing)", () => {
  it("INV-6: every text run comes from an allowed field; adversarial data stays inert text", () => {
    const d: ShareCardData = {
      ...fixture(),
      solvers: [
        {
          name: `<script>alert("hi")</script>`,
          colorLight: "#6F66D4",
          colorDark: "#9D95FF",
          title: { label: "The & wonder", detail: `"quoted" <detail>` },
        },
        { name: "Brin", colorLight: "#DE5722", colorDark: "#FF7A50" },
      ],
      puzzle: { title: "A&W <Special>", author: "O'Neill" },
    };
    const { svg } = completionCardSvg(d, {
      ground: "light",
      variant: "portrait",
    });
    // Still one well-formed document: no raw markup escaped its text node.
    expect(svg).not.toContain("<script>");
    // The complete set of rendered text, nothing else: chrome labels, stats, and the
    // caller's own display fields. No board letter can exist because none is ever
    // accepted as input; this pins that no OTHER string sneaks into a text node.
    const allowed = new Set([
      "Jul 17, 2026",
      "A&W <Special>",
      "by O'Neill · 5×5",
      "ACTIVE TIME",
      "SOLVERS",
      "SQUARES",
      "12:34",
      "2 sittings",
      "3",
      "23",
      "SOLVED BY",
      // The hostile name, truncated at the credits budget like any other name.
      `<script>alert("` + "…",
      "The & wonder",
      `"quoted" <detail>`,
      "Brin",
    ]);
    for (const run of textRuns(svg)) {
      expect(
        allowed.has(run),
        `unexpected text run: ${JSON.stringify(run)}`,
      ).toBe(true);
    }
  });

  it("INV-6: the lockup is paths, not text, so branding needs no letters either", () => {
    const d = fixture();
    const { svg } = completionCardSvg(d, {
      ground: "light",
      variant: "portrait",
    });
    expect(textRuns(svg)).not.toContain("Crossy");
  });
});

describe("ground pairing: each ground paints its own roster hex (SHARE.md)", () => {
  it("light tints Studio with colorLight; the dark hex appears nowhere", () => {
    const d = fixture();
    const { svg } = completionCardSvg(d, {
      ground: "light",
      variant: "portrait",
    });
    expect(svg).toContain(mixHex(BRAND.studio, "#6F66D4", 0.8));
    expect(svg).toContain('fill="#6F66D4"'); // the credits chip wears the full hex
    expect(svg).not.toContain("#9D95FF");
    expect(svg).not.toContain(mixHex(BRAND.observatory, "#9D95FF", 0.8));
  });

  it("dark tints Observatory with colorDark; the light hex appears nowhere", () => {
    const d = fixture();
    const { svg } = completionCardSvg(d, {
      ground: "dark",
      variant: "portrait",
    });
    expect(svg).toContain(mixHex(BRAND.observatory, "#9D95FF", 0.8));
    expect(svg).toContain('fill="#9D95FF"');
    expect(svg).not.toContain("#6F66D4");
  });

  it("the card face follows the ground: Studio light, Observatory dark", () => {
    const d = fixture();
    const light = completionCardSvg(d, {
      ground: "light",
      variant: "portrait",
    });
    const dark = completionCardSvg(d, { ground: "dark", variant: "portrait" });
    expect(light.svg).toContain(`fill="${BRAND.studio}"`);
    expect(dark.svg).toContain(`fill="${BRAND.observatory}"`);
  });
});

describe("truncation budgets (SHARE.md: no measurement, so budgets + ellipsis)", () => {
  it("ellipsizes an over-budget title, author, and name at their documented budgets", () => {
    const longTitle = "T".repeat(BUDGETS.portraitTitle + 10);
    const longAuthor = "A".repeat(BUDGETS.portraitAuthor + 10);
    const longName = "N".repeat(BUDGETS.creditName + 10);
    const d: ShareCardData = {
      ...fixture(),
      puzzle: { title: longTitle, author: longAuthor },
      solvers: [
        {
          name: longName,
          colorLight: "#6F66D4",
          colorDark: "#9D95FF",
          title: { label: "The workhorse" },
        },
        { name: "Brin", colorLight: "#DE5722", colorDark: "#FF7A50" },
      ],
    };
    const runs = textRuns(
      completionCardSvg(d, { ground: "light", variant: "portrait" }).svg,
    );
    expect(runs).toContain("T".repeat(BUDGETS.portraitTitle - 1) + "…");
    expect(runs).toContain(
      "by " + "A".repeat(BUDGETS.portraitAuthor - 1) + "… · 5×5",
    );
    expect(runs).toContain("N".repeat(BUDGETS.creditName - 1) + "…");
    expect(runs).not.toContain(longTitle);
  });
});

describe("the solo ramp (fill order, gold only where the brand allows it)", () => {
  it("is componentwise monotone toward gold as order advances (pale first, gold last)", () => {
    for (const ground of ["light", "dark"] as const) {
      const gold = parseHex(BRAND.gold)!;
      const from = parseHex(soloRampColor(0, ground))!;
      let prev = from;
      for (const t of [0.25, 0.5, 0.75, 1]) {
        const cur = parseHex(soloRampColor(t, ground))!;
        for (let ch = 0; ch < 3; ch += 1) {
          // Each channel moves from the pale end toward gold and never doubles back.
          const toward = gold[ch]! - from[ch]!;
          const step = cur[ch]! - prev[ch]!;
          expect(step * toward).toBeGreaterThanOrEqual(0);
        }
        prev = cur;
      }
      // The last square lands exactly on the brand gold.
      expect(soloRampColor(1, ground)).toBe(BRAND.gold.toLowerCase());
    }
  });

  it("paints the solo mosaic by fill order and shows the ramp key, no credits", () => {
    const base = fixture();
    const fillOrderByCell: Record<number, number> = {};
    let k = 0;
    for (let cell = 0; cell < 25; cell += 1) {
      if (base.blocks.includes(cell)) continue;
      fillOrderByCell[cell] = k / 22;
      k += 1;
    }
    const d: ShareCardData = { ...base, fillOrderByCell };
    const { svg } = completionCardSvg(d, { ground: "light", variant: "solo" });
    expect(cellRect(svg, 0).fill).toBe(soloRampColor(0, "light"));
    expect(cellRect(svg, 24).fill).toBe(soloRampColor(1, "light"));
    const runs = textRuns(svg);
    expect(runs).toContain("FIRST SQUARE");
    expect(runs).toContain("LAST SQUARE");
    expect(runs).not.toContain("SOLVED BY");
    expect(runs).not.toContain("Ada");
  });
});

describe("the board-only render (the share page's replay hero, SHARE.md S3)", () => {
  it("emits a standalone viewBox exactly the board box with the full row-major mask and zero text nodes (INV-6: no letter-shaped field exists, and the board draws no text at all)", () => {
    const d = fixture();
    const board = completionBoardSvg(d, { ground: "light" });
    // 5 cols x 40px cell, no padding: the frame straddles the board edge from the
    // inside (the play grid's registration), so nothing spills or clips.
    expect(board.svg).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 [\d.]+ [\d.]+">/,
    );
    expect(board.width).toBe(5 * 40);
    expect(board.height).toBe(board.width); // 5x5 stays square
    expect(board.svg.match(/data-cell="/g)?.length).toBe(25);
    expect(board.svg).not.toContain("<text");
    expect(cellRect(board.svg, 4).fill).toBe(LIGHT_BOARD.block);
    // The frame rect: inset by half its stroke (40px cell -> 2.22 frame, 1.11 inset),
    // width the board minus one full stroke. Inside-registered, like the game board.
    expect(board.svg).toContain(
      `<rect x="1.11" y="1.11" width="197.78" height="197.78" fill="none" stroke="${LIGHT_BOARD.frame}" stroke-width="2.22"/>`,
    );
  });

  it("agrees with the card's mosaic: the identical OWNER_TINT wash per cell, per ground", () => {
    const d = fixture();
    const light = completionBoardSvg(d, { ground: "light" }).svg;
    expect(cellRect(light, 0).fill).toBe(
      mixHex(BRAND.studio, "#6F66D4", OWNER_TINT),
    );
    const card = completionCardSvg(d, {
      ground: "light",
      variant: "portrait",
    }).svg;
    expect(cellRect(light, 7).fill).toBe(cellRect(card, 7).fill);
    const dark = completionBoardSvg(d, { ground: "dark" }).svg;
    expect(cellRect(dark, 0).fill).toBe(
      mixHex(BRAND.observatory, "#9D95FF", OWNER_TINT),
    );
    // Dark board chrome: blocks sink to the DARK_BOARD tone, not ink.
    expect(cellRect(dark, 4).fill).toBe(DARK_BOARD.block);
  });

  it("stamps the caller's class on open cells only; a block is chrome and never carries one", () => {
    const d = fixture();
    const { svg } = completionBoardSvg(d, {
      ground: "light",
      cellClassOf: (cell) => (cell === 4 || cell === 0 ? "rv k0" : undefined),
    });
    // Cell 0 (open) wears the class, after the fill so geometry parsing is untouched.
    expect(svg).toMatch(/<rect data-cell="0" [^>]*class="rv k0"\/>/);
    // Cell 4 is a block: even though the caller offered a class, none is stamped.
    expect(svg).not.toMatch(/<rect data-cell="4" [^>]*class=/);
    // An open cell the caller skipped stays classless.
    expect(svg).not.toMatch(/<rect data-cell="1" [^>]*class=/);
  });

  it("fillOrder painting is the solo gold ramp: pale first, brand gold last, no roster hex", () => {
    const base = fixture();
    const fillOrderByCell: Record<number, number> = {};
    let k = 0;
    for (let cell = 0; cell < 25; cell += 1) {
      if (base.blocks.includes(cell)) continue;
      fillOrderByCell[cell] = k / 22;
      k += 1;
    }
    const d: ShareCardData = { ...base, fillOrderByCell };
    const { svg } = completionBoardSvg(d, {
      ground: "light",
      painting: "fillOrder",
    });
    expect(cellRect(svg, 0).fill).toBe(soloRampColor(0, "light"));
    expect(cellRect(svg, 24).fill).toBe(soloRampColor(1, "light"));
    expect(svg).not.toContain(mixHex(BRAND.studio, "#6F66D4", OWNER_TINT));
  });
});

describe("snapshot stability (a fixed fixture renders the same bytes forever)", () => {
  it("is a pure function: same data, same SVG, byte for byte", () => {
    const d = fixture();
    const a = completionCardSvg(d, { ground: "light", variant: "portrait" });
    const b = completionCardSvg(d, { ground: "light", variant: "portrait" });
    expect(a.svg).toBe(b.svg);
  });

  it("matches the committed snapshot for the fixed fixture (all three variants)", () => {
    const d = fixture();
    for (const variant of ["portrait", "og", "solo"] as const) {
      for (const ground of ["light", "dark"] as const) {
        expect(completionCardSvg(d, { ground, variant }).svg).toMatchSnapshot(
          `${variant}-${ground}`,
        );
      }
    }
  });

  it("matches the committed snapshot for the board-only render (both grounds)", () => {
    const d = fixture();
    for (const ground of ["light", "dark"] as const) {
      expect(completionBoardSvg(d, { ground }).svg).toMatchSnapshot(
        `board-only-${ground}`,
      );
    }
  });
});
