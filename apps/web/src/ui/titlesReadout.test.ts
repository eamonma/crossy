// The Titles section's contract (design/post-game/TITLES.md; PROTOCOL §12 titles row): the wire's
// {userId, title, evidence} resolves to render-ready cards in ladder-rank (wire) order, names and
// colors ride the same resolution the legend and the mosaic use, an unknown key from a newer
// server is dropped (the MUST-ignore rule, how the ladder grows without client lockstep), and an
// empty array yields no cards so the panel renders no section (the solo rule). Evidence formats
// per rung semantics: counts as counts (pluralized), whole-seconds rungs as M:SS through the same
// formatMSS the header uses, no-evidence rungs as their fixed line, and a numeric rung with a
// missing number drops the line rather than printing a blank. The amended law rides the copy: a
// card cites only its own number, never a rate or a rank.
import { describe, expect, it } from "vitest";
import { TITLE_LADDER } from "@crossy/engine";
import type { Roster } from "./mosaicReveal";
import type { WireTitle } from "./completionAttribution";
import type { LegendMember } from "./analysisReadout";
import { TITLE_COPY, titleCards, titleCopyOf } from "./titlesReadout";

const members: LegendMember[] = [
  { userId: "u-mara", name: "Mara", color: "#e5484d" },
  { userId: "me", name: "Real Name", color: "#3e63dd" },
  { userId: "u-jia", name: "Jia", color: "#12a594" },
];

const roster: Roster = {
  "u-mara": { color: "#red-resolved" },
  me: { color: "#indigo-resolved" },
  "u-jia": { color: "#teal-resolved" },
};

function award(
  userId: string,
  title: string,
  evidence: number | null,
): WireTitle {
  return { userId, title, evidence };
}

describe("titleCards (the wire's awards become the section's cards)", () => {
  it("renders names, claims, and evidence for a two-solver payload, in wire (ladder-rank) order", () => {
    const cards = titleCards(
      [award("u-mara", "saboteur", 7), award("me", "workhorse", 42)],
      members,
      "me",
      roster,
    );
    expect(cards).toEqual([
      {
        userId: "u-mara",
        name: "Mara",
        color: "#red-resolved",
        label: "The saboteur",
        detail: "Overwrote 7 correct squares",
      },
      {
        userId: "me",
        name: "You", // self resolves to "You", the legend's own rule
        color: "#indigo-resolved",
        label: "The workhorse",
        detail: "42 squares filled",
      },
    ]);
  });

  it("skips an unknown title key without crashing (PROTOCOL §12: a client MUST ignore an unknown key)", () => {
    // A newer server's ladder grew past this build: the older client drops the award and
    // keeps the rest, never a crash and never a placeholder card.
    const cards = titleCards(
      [
        award("u-mara", "night-owl", 5),
        award("me", "workhorse", 12),
        award("u-jia", "not-a-title", null),
      ],
      members,
      null,
      roster,
    );
    expect(cards.map((c) => c.userId)).toEqual(["me"]);
  });

  it("the marathoner (D29 fast-follow, TITLES.md rank 8) renders first-class off the wire string", () => {
    // The copy ships ahead of the engine walk (Wave 12.2): the wire key resolves to a
    // card today, so the first awarding server never hits the unknown-key drop.
    const cards = titleCards(
      [award("u-jia", "marathoner", 2)],
      members,
      "me",
      roster,
    );
    expect(cards).toEqual([
      {
        userId: "u-jia",
        name: "Jia",
        color: "#teal-resolved",
        label: "The marathoner",
        detail: "Showed up for all 2 sittings",
      },
    ]);
  });

  it("a hostile key can never reach the copy record's prototype (constructor is not a title)", () => {
    expect(titleCopyOf("constructor")).toBeNull();
    expect(titleCopyOf("hasOwnProperty")).toBeNull();
    expect(
      titleCards([award("u-mara", "constructor", 1)], members, null, roster),
    ).toEqual([]);
  });

  it("an empty titles array yields no cards, so the panel renders no section (the solo rule)", () => {
    expect(titleCards([], members, "me", roster)).toEqual([]);
  });

  it("falls back for a departed member: a plain name and a null color, never a crash", () => {
    const cards = titleCards(
      [award("u-gone", "bullseye", 9)],
      members,
      "me",
      roster,
    );
    expect(cards).toEqual([
      {
        userId: "u-gone",
        name: "A solver",
        color: null, // the panel's Dot renders neutral sand for a null color
        label: "The bullseye",
        detail: "9 squares, none wrong",
      },
    ]);
  });
});

describe("evidence formatting per rung semantics (TITLES.md ladder table)", () => {
  it("a count rung folds its number in, pluralized ('1 square' never '1 squares')", () => {
    expect(TITLE_COPY["quick-starter"].detail(1)).toBe(
      "1 square in the opening stretch",
    );
    expect(TITLE_COPY["quick-starter"].detail(8)).toBe(
      "8 squares in the opening stretch",
    );
    expect(TITLE_COPY.meddler.detail(2)).toBe(
      "Finished 2 words others started",
    );
    expect(TITLE_COPY.collector.detail(17)).toBe("Had a hand in 17 words");
    // The marathoner's evidence is the sitting count, always >= 2 (the gate refuses a
    // one-sitting room), but the copy rides the same pluralization idiom regardless.
    expect(TITLE_COPY.marathoner.detail(3)).toBe(
      "Showed up for all 3 sittings",
    );
  });

  it("the whole-seconds rungs render M:SS through formatMSS (ice-breaker's stall, long-hauler's span)", () => {
    expect(TITLE_COPY["ice-breaker"].detail(240)).toBe(
      "Ended the room's 4:00 silence",
    );
    expect(TITLE_COPY["long-hauler"].detail(1572)).toBe(
      "On the case for 26:12",
    );
  });

  it("the sprinter's window is the shared engine constant (BURST_WINDOW_MS), never a hand-typed 30", () => {
    expect(TITLE_COPY.sprinter.detail(9)).toBe("9 squares in 30 seconds");
  });

  it("a null-evidence rung carries its fixed line (the wire's evidence is null by design)", () => {
    expect(TITLE_COPY["one-hit-wonder"].detail(null)).toBe(
      "One square, flawlessly chosen",
    );
    expect(TITLE_COPY.wanderer.detail(null)).toBe("Roamed the whole grid");
  });

  it("a numeric rung with a missing number drops the line, never printing a blank or 'null'", () => {
    expect(TITLE_COPY.saboteur.detail(null)).toBeNull();
    const cards = titleCards(
      [award("u-mara", "saboteur", null)],
      members,
      null,
      roster,
    );
    expect(cards[0]?.detail).toBeNull(); // the card still renders: label + name, no detail line
    expect(cards[0]?.label).toBe("The saboteur");
  });
});

describe("the copy table covers the pinned ladder (a ladder edit is a compile error here)", () => {
  it("every TITLE_LADDER rung has copy, and its detail agrees with the rung's evidence semantics", () => {
    for (const rung of TITLE_LADDER) {
      const copy = titleCopyOf(rung.key);
      expect(copy, rung.key).not.toBeNull();
      expect(copy!.label.length).toBeGreaterThan(0);
      if (rung.evidence === null) {
        // A no-evidence rung must carry a fixed line off the wire's null.
        expect(copy!.detail(null), rung.key).not.toBeNull();
      } else {
        // An evidence-bearing rung must fold a number into a non-empty line.
        expect(copy!.detail(7), rung.key).not.toBeNull();
      }
    }
  });
});
