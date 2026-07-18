// @crossy/share-card: the completion share card as a pure SVG builder
// (design/post-game/SHARE.md). Imports nothing — no npm deps, no workspace packages,
// no node builtins — so any runtime (browser, worker, server) can render the same
// bytes; the dependency-cruiser rule share-card-is-standalone enforces it.
export type {
  RenderedCard,
  ShareCardData,
  ShareCardOptions,
  ShareCardSolver,
  ShareCardStats,
} from "./types";
export type { BoardOnlyOptions } from "./card";
export {
  BARE_CELL,
  BOARD_ONLY_CELL,
  BUDGETS,
  DARK_BOARD,
  LIGHT_BOARD,
  MAX_CREDITS,
  MAX_OG_CREDITS,
  OWNER_TINT,
  completionBoardSvg,
  completionCardSvg,
  soloRampColor,
} from "./card";
export { GRID_MODULE } from "./board";
export { BRAND } from "./brand";
export { mixHex, parseHex } from "./color";
export { escapeXml, formatClock, truncate } from "./text";
