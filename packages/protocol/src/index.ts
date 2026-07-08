// Message schemas and the ServerPuzzle/ClientPuzzle split (INV-6) land in Wave 1.1a,
// mirroring PROTOCOL.md §§2-6. This package never imports workspace code: it is the
// contract everything else depends on.

// PROTOCOL.md §2: the server supports version N and N-1.
export const PROTOCOL_VERSION = 1;
