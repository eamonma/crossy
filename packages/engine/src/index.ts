// Pure domain: reducer, comparator, navigation (DESIGN §4, §5). Implemented in Wave
// 2.1a, driven red-to-green by vectors/. INV-9: this package imports nothing; all
// timestamps and user ids arrive as data. The public surface is small and intention
// revealing; the engine owns these types, apps adapt at their boundary (see README.md).
export type {
  BoardState,
  Cell,
  CellSet,
  CheckPuzzle,
  ClearCell,
  Command,
  CompletionResult,
  Direction,
  Event,
  GameCompleted,
  Grid,
  PlaceLetter,
  PuzzleChecked,
  ReduceResult,
  RejectionCode,
  Solution,
  Status,
  Toward,
} from "./types";
export { matches } from "./comparator";
export { applyWithCompletion } from "./completion";
export { firstCorrect } from "./first-correct";
export type { OwnerMap, WriteEvent } from "./first-correct";
export {
  BURST_WINDOW_MS,
  MOMENTUM_SAMPLES,
  moments,
  momentum,
  solveSequence,
  solveTrace,
} from "./analysis";
export type {
  Beat,
  SequenceStep,
  SolveEvent,
  TraceEntry,
  TurningPoint,
} from "./analysis";
export {
  awardTitles,
  BULLSEYE_MIN_FILLS,
  MARQUEE_MIN_LENGTH,
  MEDDLER_MIN,
  OPENING_SHARE,
  SABOTEUR_MIN,
  SPRINTER_MIN_BURST,
  STALL_FLOOR_SECONDS,
  TITLE_LADDER,
  titleStats,
} from "./titles";
export type {
  FillMark,
  Geometry,
  RungContext,
  SolverStats,
  StatColumn,
  TitleAward,
  TitleKey,
  TitleRow,
  TitleRung,
  TitleSlot,
  TitleStatsResult,
} from "./titles";
export { reduce } from "./reducer";
export {
  backspaceTarget,
  getNextCell,
  tabTarget,
  typingAdvance,
  wordBounds,
} from "./navigation";
