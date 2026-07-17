// The share card assembly's contract (design/post-game/SHARE.md): wire-ordered
// credits, both-ground colors off the shared identity roster, the Titles panel's own
// copy (never forked strings), the solo rule, and the masthead fallback chain. The
// no-letters guarantee itself is pinned in @crossy/share-card (INV-6-cited there);
// this suite pins that web feeds it only ids, counts, and display metadata.
import { describe, expect, it } from "vitest";
import {
  assembleShareCard,
  fillOrderOf,
  formatShareDate,
  groundFromTheme,
  shareFilename,
  type ShareCardInput,
} from "./shareCardData";
import { identityColor } from "../ui/identityRoster";
import { TITLE_COPY } from "../ui/titlesReadout";
import type { AnalysisResponse } from "../ui/completionAttribution";

const NOW = new Date(2026, 6, 17); // Jul 17, 2026 (month is 0-indexed)

function bundle(overrides: Partial<AnalysisResponse> = {}): AnalysisResponse {
  return {
    owners: { 0: "u-ada", 1: "u-brin", 2: "u-ada", 3: "u-brin" },
    momentum: { durationSeconds: 754, samples: [] },
    moments: { firstToFall: null, lastSquare: null, turningPoint: null },
    sequence: [
      { cell: 0, atSeconds: 1 },
      { cell: 1, atSeconds: 5 },
      { cell: 2, atSeconds: 9 },
      { cell: 3, atSeconds: 12 },
    ],
    titles: [
      { userId: "u-brin", title: "saboteur", evidence: 3 },
      { userId: "u-ada", title: "workhorse", evidence: 11 },
    ],
    sittings: { count: 2, spans: [], wallSeconds: 9000 },
    ...overrides,
  };
}

function input(overrides: Partial<ShareCardInput> = {}): ShareCardInput {
  return {
    bundle: bundle(),
    members: [
      { userId: "u-ada", name: "Ada", color: "#3e63dd" },
      { userId: "u-brin", name: "Brin", color: "#e5484d" },
    ],
    cols: 2,
    rows: 2,
    blocks: [],
    puzzleTitle: "Saturday Stumper",
    puzzleAuthor: "E. Longo",
    roomName: "Friday night",
    gameId: "0a1b2c3d-4e5f-6789-abcd-ef0123456789",
    ...overrides,
  };
}

describe("credits order and identity (TITLES.md: wire order IS ladder order; never sorted here)", () => {
  it("lists titled solvers in wire order, then untitled owners in room order", () => {
    const withCleo = input({
      bundle: bundle({
        owners: { 0: "u-ada", 1: "u-brin", 2: "u-cleo", 3: "u-brin" },
      }),
      members: [
        { userId: "u-ada", name: "Ada", color: "#3e63dd" },
        { userId: "u-cleo", name: "Cleo", color: "#12a594" },
        { userId: "u-brin", name: "Brin", color: "#e5484d" },
      ],
    });
    const { data } = assembleShareCard(withCleo, NOW);
    // Brin leads (rank 1 on the wire), Ada second, then untitled Cleo.
    expect(data.solvers.map((s) => s.name)).toEqual(["Brin", "Ada", "Cleo"]);
  });

  it("resolves BOTH ground hexes per solver through the shared identity roster", () => {
    const { data } = assembleShareCard(input(), NOW);
    const ada = data.solvers.find((s) => s.name === "Ada")!;
    expect(ada.colorLight).toBe(identityColor("#3e63dd", false));
    expect(ada.colorDark).toBe(identityColor("#3e63dd", true));
    expect(ada.colorLight).not.toBe(ada.colorDark);
  });

  it("maps ownersByCell onto solver indices consistent with the credits order", () => {
    const { data } = assembleShareCard(input(), NOW);
    const brinIdx = data.solvers.findIndex((s) => s.name === "Brin");
    const adaIdx = data.solvers.findIndex((s) => s.name === "Ada");
    expect(data.ownersByCell[0]).toBe(adaIdx);
    expect(data.ownersByCell[1]).toBe(brinIdx);
  });

  it("credits an owner the snapshot no longer knows as the neutral solver, never a crash", () => {
    const departed = input({
      members: [{ userId: "u-ada", name: "Ada", color: "#3e63dd" }],
    });
    const { data } = assembleShareCard(departed, NOW);
    expect(data.solvers.some((s) => s.name === "A solver")).toBe(true);
  });
});

describe("title copy rides the Titles panel's own words (TITLE_COPY, no forked strings)", () => {
  it("labels and evidence lines equal the panel copy byte for byte", () => {
    const { data } = assembleShareCard(input(), NOW);
    const brin = data.solvers.find((s) => s.name === "Brin")!;
    expect(brin.title?.label).toBe(TITLE_COPY.saboteur.label);
    expect(brin.title?.detail).toBe(TITLE_COPY.saboteur.detail(3)!);
  });

  it("ignores an unknown title key (PROTOCOL §12 MUST-ignore) but still credits the solver", () => {
    const future = input({
      bundle: bundle({
        titles: [{ userId: "u-brin", title: "time-traveler", evidence: 9 }],
      }),
    });
    const { data } = assembleShareCard(future, NOW);
    const brin = data.solvers.find((s) => s.name === "Brin")!;
    expect(brin.title).toBeUndefined();
  });
});

describe("the solo rule (TITLES.md: a superlative is social; below two writers, fill order)", () => {
  it("builds the solo variant from the replay sequence when titles are empty", () => {
    const solo = input({
      bundle: bundle({
        owners: { 0: "u-ada", 1: "u-ada", 2: "u-ada", 3: "u-ada" },
        titles: [],
      }),
    });
    const { variant, data } = assembleShareCard(solo, NOW);
    expect(variant).toBe("solo");
    expect(data.fillOrderByCell).toBeDefined();
    // Rank-mapped onto [0, 1], ascending with the sequence.
    expect(data.fillOrderByCell![0]).toBe(0);
    expect(data.fillOrderByCell![3]).toBe(1);
  });

  it("builds the portrait variant for a real multi-writer room", () => {
    const { variant, data } = assembleShareCard(input(), NOW);
    expect(variant).toBe("portrait");
    expect(data.fillOrderByCell).toBeUndefined();
  });

  it("fillOrderOf maps a single fill to the pale end and an empty sequence to nothing", () => {
    expect(fillOrderOf([{ cell: 7, atSeconds: 3 }])).toEqual({ 7: 0 });
    expect(fillOrderOf([])).toEqual({});
  });
});

describe("stats and masthead (the bundle's numbers; the fallback chain)", () => {
  it("reads active seconds, sittings, solvers, and squares off the bundle", () => {
    const { data } = assembleShareCard(input(), NOW);
    expect(data.stats).toEqual({
      activeSeconds: 754,
      sittingCount: 2,
      solverCount: 2,
      squareCount: 4,
    });
  });

  it("defaults the sitting count to 1 when the bundle predates sittings (additive tolerance)", () => {
    const legacy: Record<string, unknown> = { ...bundle() };
    delete legacy["sittings"];
    const { data } = assembleShareCard(
      { ...input(), bundle: legacy as unknown as AnalysisResponse },
      NOW,
    );
    expect(data.stats.sittingCount).toBe(1);
  });

  it("falls back puzzle title -> room name -> dims; the author is only ever the real byline", () => {
    expect(assembleShareCard(input(), NOW).data.puzzle).toEqual({
      title: "Saturday Stumper",
      author: "E. Longo",
    });
    expect(
      assembleShareCard(input({ puzzleTitle: null }), NOW).data.puzzle.title,
    ).toBe("Friday night");
    expect(
      assembleShareCard(input({ puzzleTitle: null, roomName: null }), NOW).data
        .puzzle.title,
    ).toBe("2 × 2");
    expect(
      assembleShareCard(input({ puzzleAuthor: null }), NOW).data.puzzle.author,
    ).toBeNull();
  });

  it("stamps the client-clock date in the fixed display format", () => {
    expect(formatShareDate(NOW)).toBe("Jul 17, 2026");
    expect(assembleShareCard(input(), NOW).data.solvedOn).toBe("Jul 17, 2026");
  });
});

describe("the export handles (filename, ground)", () => {
  it("names the file by the game id prefix", () => {
    expect(shareFilename("0a1b2c3d-4e5f-6789-abcd-ef0123456789")).toBe(
      "crossy-0a1b2c3d.png",
    );
    expect(assembleShareCard(input(), NOW).filename).toBe(
      "crossy-0a1b2c3d.png",
    );
  });

  it("follows the html data-theme stamp; anything else is light", () => {
    expect(groundFromTheme("dark")).toBe("dark");
    expect(groundFromTheme("light")).toBe("light");
    expect(groundFromTheme(null)).toBe("light");
  });
});
