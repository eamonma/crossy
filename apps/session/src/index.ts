// Session service: one in-memory actor per live game, the single writer for its game
// (DESIGN.md §6). Handshake, mailbox, hydrate land in Wave 2.1c; write-behind flush
// and drain in Wave 2.2.
export {};
