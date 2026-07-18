// The error-code table, pinned against PROTOCOL.md §11 verbatim.
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "./errors";
import type { ErrorCode, Fatality } from "./errors";

// The §11 table: code -> fatality. `INTERNAL` is "varies" (fatal:true means reconnect).
const TABLE: Record<ErrorCode, Fatality> = {
  UNAUTHORIZED: true,
  NOT_PARTICIPANT: true,
  DENIED: true,
  GAME_NOT_FOUND: true,
  PROTOCOL_VERSION_UNSUPPORTED: true,
  GAME_NOT_ONGOING: false,
  INVALID_CELL: false,
  INVALID_VALUE: false,
  GRID_NOT_FULL: false,
  VOTE_PENDING: false,
  NO_VOTE_OPEN: false,
  NOT_ELECTOR: false,
  ALREADY_VOTED: false,
  ROLE_FORBIDDEN: false,
  RATE_LIMITED: false,
  UNKNOWN_TYPE: false,
  INTERNAL: "varies",
};

describe("error codes (PROTOCOL.md §11)", () => {
  it("lists exactly the seventeen protocol error codes (four vote codes added, D32)", () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual(Object.keys(TABLE).sort());
  });

  it("classifies fatality per the §11 table, with INTERNAL as varies", () => {
    for (const [code, fatal] of Object.entries(TABLE)) {
      expect(ERROR_CODES[code as ErrorCode].fatal).toBe(fatal);
    }
  });

  it("carries a human-readable meaning for every code", () => {
    for (const code of Object.keys(TABLE) as ErrorCode[]) {
      expect(ERROR_CODES[code].meaning.length).toBeGreaterThan(0);
    }
  });
});
