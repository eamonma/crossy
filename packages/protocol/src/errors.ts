// The error message and the error-code table (PROTOCOL.md §11). Fatal errors are followed by a
// `1008` close; non-fatal errors carry the offending `commandId` so the client clears its overlay
// entry (§8). `INTERNAL` fatality varies: the wire `error.fatal` is always a concrete boolean,
// while this table records the policy, so `varies` lives here, never on the wire.

/** Every protocol error code (PROTOCOL.md §11). */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "NOT_PARTICIPANT"
  | "DENIED"
  | "GAME_NOT_FOUND"
  | "PROTOCOL_VERSION_UNSUPPORTED"
  | "GAME_NOT_ONGOING"
  | "INVALID_CELL"
  | "INVALID_VALUE"
  | "GRID_NOT_FULL"
  | "VOTE_PENDING"
  | "NO_VOTE_OPEN"
  | "NOT_ELECTOR"
  | "ALREADY_VOTED"
  | "ROLE_FORBIDDEN"
  | "RATE_LIMITED"
  | "UNKNOWN_TYPE"
  | "INTERNAL";

/** Fatality classification. `true`/`false` are fixed; `"varies"` is decided per occurrence. */
export type Fatality = boolean | "varies";

interface ErrorSpec {
  readonly fatal: Fatality;
  readonly meaning: string;
}

/** The §11 table as data: the single source of truth for codes, fatality, and meaning. */
export const ERROR_CODES: Readonly<Record<ErrorCode, ErrorSpec>> = {
  UNAUTHORIZED: {
    fatal: true,
    meaning: "bad or missing token, or the first frame was not hello",
  },
  NOT_PARTICIPANT: {
    fatal: true,
    meaning: "authenticated, but not a member of this game",
  },
  DENIED: { fatal: true, meaning: "on the game's denylist" },
  GAME_NOT_FOUND: { fatal: true, meaning: "unknown gameId" },
  PROTOCOL_VERSION_UNSUPPORTED: {
    fatal: true,
    meaning: "version outside {N, N-1}",
  },
  GAME_NOT_ONGOING: {
    fatal: false,
    meaning: "mutation after a terminal state",
  },
  INVALID_CELL: { fatal: false, meaning: "out of range, or a black square" },
  INVALID_VALUE: { fatal: false, meaning: "fails ^[A-Z0-9]{1,10}$" },
  GRID_NOT_FULL: {
    fatal: false,
    meaning: "checkPuzzle while a playable cell is empty",
  },
  VOTE_PENDING: {
    fatal: false,
    meaning: "checkPuzzle while a check vote is already open",
  },
  NO_VOTE_OPEN: {
    fatal: false,
    meaning: "castCheckVote with no matching open vote, or a stale voteSeq",
  },
  NOT_ELECTOR: {
    fatal: false,
    meaning: "castCheckVote from a sender outside the frozen electorate",
  },
  ALREADY_VOTED: {
    fatal: false,
    meaning: "castCheckVote from a sender who has already voted",
  },
  ROLE_FORBIDDEN: { fatal: false, meaning: "a spectator sent a mutation" },
  RATE_LIMITED: { fatal: false, meaning: "slow down" },
  UNKNOWN_TYPE: { fatal: false, meaning: "unrecognized command type" },
  INTERNAL: {
    fatal: "varies",
    meaning: "server fault; fatal:true means reconnect",
  },
};
