// The share-card board drift tripwire. @crossy/share-card imports nothing
// (share-card-is-standalone), so it mirrors the play grid's board tokens as hardcoded
// copies (LIGHT_BOARD / DARK_BOARD / BARE_CELL / GRID_MODULE, provenance comments in
// packages/share-card/src). Nothing at build time ties the copies to the CSS, so this
// suite re-derives the game's tokens from the styles.css SOURCE and pins the card's
// copies against them: restyle the game board and these tests flag the share card for
// a matching pass (SHARE.md "the board is the bona fide play grid").
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BARE_CELL,
  DARK_BOARD,
  GRID_MODULE,
  LIGHT_BOARD,
} from "@crossy/share-card";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "styles.css"),
  "utf8",
);

// The theme scopes, from source: light is everything before the dark selector BLOCK
// (the selector string also appears in prose comments, so key on selector + brace);
// dark is that block's declarations, falling back to light for anything it does not
// re-point (CSS custom-property inheritance, resolved the same way here).
const darkMatch = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(css);
const LIGHT_SCOPE = css.slice(0, darkMatch?.index ?? css.length);
const DARK_SCOPE = darkMatch?.[1] ?? "";

/** The literal value of `--name` in one scope's source, or null. Anchored so a token
 * never matches a longer token's tail (--stroke vs --grid-stroke). */
function declared(scope: string, name: string): string | null {
  const m = new RegExp(`(?<![\\w-])${name}\\s*:\\s*([^;]+);`).exec(scope);
  return m === null ? null : m[1]!.trim();
}

/** Resolve `--name` for a theme: read the dark scope first (dark only), fall back to
 * light, and chase var() chains until a literal value remains. */
function tokenOf(theme: "light" | "dark", name: string): string {
  const value =
    (theme === "dark" ? declared(DARK_SCOPE, name) : null) ??
    declared(LIGHT_SCOPE, name);
  expect(value, `styles.css declares ${name}`).not.toBeNull();
  const chained = /var\(\s*(--[\w-]+)\s*\)/.exec(value!);
  return chained === null ? value!.toLowerCase() : tokenOf(theme, chained[1]!);
}

describe("share-card board drift tripwire: the card's hardcoded chrome equals the play grid tokens in styles.css", () => {
  it("light board chrome mirrors :root --cell-block / --stroke / --board-frame / --cell-default", () => {
    expect(LIGHT_BOARD.block).toBe(tokenOf("light", "--cell-block"));
    expect(LIGHT_BOARD.line).toBe(tokenOf("light", "--stroke"));
    expect(LIGHT_BOARD.frame).toBe(tokenOf("light", "--board-frame"));
    expect(BARE_CELL.light).toBe(tokenOf("light", "--cell-default"));
  });

  it('dark board chrome mirrors the same tokens under :root[data-theme="dark"]', () => {
    expect(DARK_BOARD.block).toBe(tokenOf("dark", "--cell-block"));
    expect(DARK_BOARD.line).toBe(tokenOf("dark", "--stroke"));
    expect(DARK_BOARD.frame).toBe(tokenOf("dark", "--board-frame"));
    expect(BARE_CELL.dark).toBe(tokenOf("dark", "--cell-default"));
  });

  it("stroke geometry mirrors the 36px module: --grid-cell / --grid-stroke / --grid-frame", () => {
    expect(`${GRID_MODULE.cell}px`).toBe(tokenOf("light", "--grid-cell"));
    expect(`${GRID_MODULE.line}px`).toBe(tokenOf("light", "--grid-stroke"));
    expect(`${GRID_MODULE.frame}px`).toBe(tokenOf("light", "--grid-frame"));
  });
});
