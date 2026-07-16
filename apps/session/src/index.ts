// Session service: one in-memory actor per live game, the single writer for its game
// (DESIGN.md §6). Wave 2.1c landed the handshake (PROTOCOL.md §2), the actor mailbox,
// lazy hydration, and placeLetter/clearCell to cellSet broadcast. Wave 2.2 adds the
// write-behind flush, terminal-synchronous completion with authoritative participantCount,
// reconnect resync, and the SIGTERM drain.
export { createSessionServer } from "./server";
export type { SessionServer, SessionServerConfig } from "./server";
export { GameActor, FLUSH_EVENT_THRESHOLD, FLUSH_INTERVAL_MS } from "./actor";
export type { ActorOptions, Connection } from "./actor";
export { ActorRegistry } from "./registry";
export { Mailbox } from "./mailbox";
export { hydrateGame } from "./hydrate";
export type {
  EngineSolution,
  GameStateRow,
  HydratedGame,
  PuzzleSnapshot,
  RawCell,
} from "./hydrate";
export {
  boardCells,
  buildBoard,
  cellSetToWire,
  checkedWrongAscending,
  puzzleCheckedToWire,
  toEngineCommand,
} from "./adapt";
// The color derivation moved to @crossy/protocol (D28: the room-aware assignment lives where both
// services can reach it); re-exported so this surface is unchanged.
export { colorForUser } from "@crossy/protocol";
export {
  createPgPersistence,
  flushToPostgres,
  flushTerminalToPostgres,
  countDistinctWriters,
} from "./writer";
export type {
  BoardSnapshot,
  CheckEventRow,
  GamePersistence,
  StateSnapshot,
} from "./writer";
