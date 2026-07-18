// Pins the API's title-label table to the cross-client contract (design/post-game/TITLES.md,
// vectors/analysis/title-labels.json). The server-rendered share card must credit a title with the
// exact words the web, iOS, and Android surfaces paint, so if the API's TITLE_LABELS ever drifts
// from the frozen labels, this fails. The vector is the same language-neutral ground apps/web,
// apps/ios, and apps/android pin against, so a green run here means the card's credits match every
// client surface (INV-1: labels are display strings, never folded or compared).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TITLE_LABELS, titleLabelOf } from "./titleLabels";

const here = dirname(fileURLToPath(import.meta.url));
const vector = JSON.parse(
  readFileSync(
    resolve(here, "../../../../vectors/analysis/title-labels.json"),
    "utf8",
  ),
) as { labels: { key: string; label: string }[] };

describe("API title labels match the cross-client vector (TITLES.md; PROTOCOL.md §12)", () => {
  it("carries exactly the pinned labels, byte for byte, and no extra keys", () => {
    const fromVector = Object.fromEntries(
      vector.labels.map((l) => [l.key, l.label]),
    );
    expect(TITLE_LABELS).toEqual(fromVector);
  });

  it("resolves each pinned key to its exact label through titleLabelOf", () => {
    for (const { key, label } of vector.labels) {
      expect(titleLabelOf(key)).toBe(label);
    }
  });

  it("ignores an unknown key (PROTOCOL.md §12: a client MUST ignore an unknown title)", () => {
    // A newer server's ladder grew (as it did with marathoner): the label is absent here, so the
    // card credits the solver with no title line rather than inventing copy or crashing.
    expect(titleLabelOf("night-owl")).toBeNull();
    expect(titleLabelOf("")).toBeNull();
    // A prototype key must never leak the record's prototype (Object.hasOwn guard).
    expect(titleLabelOf("constructor")).toBeNull();
    expect(titleLabelOf("toString")).toBeNull();
  });
});
