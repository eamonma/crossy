import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Clue } from "../domain/types";
import { ActiveClueHeader } from "./Clues";

const clue: Clue = {
  number: 18,
  direction: "across",
  cells: [0, 1, 2],
  text: "Capital of France",
};

describe("ActiveClueHeader", () => {
  it("keeps both responsive clue bars after completion (INV-4; DESIGN.md section 5)", () => {
    const html = renderToStaticMarkup(
      createElement(ActiveClueHeader, {
        clue,
        completed: true,
        onOpen: vi.fn(),
        onPrev: vi.fn(),
        onNext: vi.fn(),
      }),
    );

    expect(html.match(/Capital of France/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Previous clue"');
    expect(html).toContain('aria-label="Next clue"');
    expect(html).toContain('aria-label="Show all clues and analysis"');
    expect(html).not.toContain("See how the room solved it");
  });
});
