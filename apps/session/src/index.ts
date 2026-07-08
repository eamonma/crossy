// Session service: one in-memory actor per live game, the single writer for its game
// (DESIGN.md §6). Wave 2.1c lands the handshake (PROTOCOL.md §2), the actor mailbox,
// lazy hydration, and placeLetter/clearCell to cellSet broadcast. Write-behind flush and
// drain are Wave 2.2.
export { createSessionServer } from "./server";
export type { SessionServer, SessionServerConfig } from "./server";
export { GameActor } from "./actor";
export type { Connection } from "./actor";
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
export { buildBoard, cellSetToWire, toEngineCommand } from "./adapt";
export { colorForUser } from "./color";
