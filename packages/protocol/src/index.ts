// @crossy/protocol: the shared wire contract (PROTOCOL.md §§2-6, §11). This package depends on
// nothing and everything depends on it (DESIGN.md §4). Exported TypeScript types stand alone; the
// codec validates frames with hand-rolled guards, so a Swift port can mirror the same shapes via
// Codable and the conformance vectors without a schema library to reproduce.

// PROTOCOL.md §2, §14: the current protocol version. The server supports N and N-1.
export const PROTOCOL_VERSION = 1;

export * from "./values";
export * from "./puzzle";
export * from "./board";
export * from "./errors";
export * from "./messages";
