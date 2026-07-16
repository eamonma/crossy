// The ribbon's sitting seams as rendered markup (react-dom/server under the node test
// environment, the AnalysisPanel.test.tsx idiom): a bundle carrying sittings (D29) draws one
// recessive hairline per interior boundary, positioned through the SAME time-to-x pipeline the
// break marker uses, so the seams sit at pinned x fractions of the plot. An older bundle (no
// sittings field) or a single-sitting solve draws none, byte-identical to today's ribbon —
// the PROTOCOL §12 MUST-tolerate-absence rule as pixels.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MomentumRibbon } from "./MomentumRibbon";
import type { AnalysisResponse, Sittings } from "./completionAttribution";

function bundle(sittings?: Sittings): AnalysisResponse {
  return {
    owners: {},
    momentum: {
      durationSeconds: 100,
      samples: Array.from({ length: 40 }, () => 0.5),
    },
    moments: { firstToFall: null, lastSquare: null, turningPoint: null },
    sequence: [],
    titles: [],
    ...(sittings !== undefined && { sittings }),
  };
}

const seams = (html: string): number => html.match(/data-seam/g)?.length ?? 0;

describe("the ribbon's sitting seams (D29: a quiet tick at each interior boundary)", () => {
  it("draws one seam for a two-sitting solve at the pinned x fraction", () => {
    // Boundary at 25s of a 100s active axis: index = 25/100 * 39 = 9.75, so
    // x = padX + 0.25 * plotWidth = 4 + 0.25 * 332 = 87 (the BOX the ribbon pins).
    const html = renderToStaticMarkup(
      <MomentumRibbon
        bundle={bundle({
          count: 2,
          spans: [
            { startSeconds: 0, endSeconds: 25 },
            { startSeconds: 25, endSeconds: 100 },
          ],
          wallSeconds: 29160,
        })}
        idBase="t"
      />,
    );
    expect(seams(html)).toBe(1);
    expect(html).toContain('x1="87"');
  });

  it("draws count-1 seams for a three-sitting solve, each at its own pinned x", () => {
    const html = renderToStaticMarkup(
      <MomentumRibbon
        bundle={bundle({
          count: 3,
          spans: [
            { startSeconds: 0, endSeconds: 25 },
            { startSeconds: 25, endSeconds: 50 },
            { startSeconds: 50, endSeconds: 100 },
          ],
          wallSeconds: 100000,
        })}
        idBase="t"
      />,
    );
    expect(seams(html)).toBe(2);
    expect(html).toContain('x1="87"'); // 25s -> 25% of the plot
    expect(html).toContain('x1="170"'); // 50s -> 50% of the plot
  });

  it("draws none when sittings are absent (an older cached bundle renders today's ribbon)", () => {
    const html = renderToStaticMarkup(
      <MomentumRibbon bundle={bundle()} idBase="t" />,
    );
    expect(seams(html)).toBe(0);
  });

  it("draws none for a single sitting: markup byte-identical to the absent field", () => {
    const single = renderToStaticMarkup(
      <MomentumRibbon
        bundle={bundle({
          count: 1,
          spans: [{ startSeconds: 0, endSeconds: 100 }],
          wallSeconds: 100,
        })}
        idBase="t"
      />,
    );
    const absent = renderToStaticMarkup(
      <MomentumRibbon bundle={bundle()} idBase="t" />,
    );
    expect(single).toBe(absent);
  });

  it("draws none on a flat series (no signal): no shape to seam, matching the break marker's gate", () => {
    const flat: AnalysisResponse = {
      ...bundle({
        count: 2,
        spans: [
          { startSeconds: 0, endSeconds: 25 },
          { startSeconds: 25, endSeconds: 100 },
        ],
        wallSeconds: 29160,
      }),
      momentum: {
        durationSeconds: 100,
        samples: Array.from({ length: 40 }, () => 0),
      },
    };
    const html = renderToStaticMarkup(
      <MomentumRibbon bundle={flat} idBase="t" />,
    );
    expect(seams(html)).toBe(0);
  });
});
