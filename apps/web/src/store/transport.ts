// The store's outbound port. The store never touches a socket: it speaks wire types
// through this interface, so the vector suite drives it with a recording fake and the
// real WebSocket transport (src/net) implements it. Inbound frames arrive by the owner
// of the transport calling store.receive with a codec-decoded ServerMessage
// (packages/protocol), so parsing is never hand-rolled here (DESIGN.md section 4:
// protocol codec / store / views).
import type { ClientMessage } from "@crossy/protocol";

export interface GameTransport {
  /**
   * Send one client-to-server frame. Implementations may drop the frame when no
   * socket is open: a dropped mutation stays in the overlay and snapshot
   * reconciliation re-sends it (PROTOCOL.md section 8), so delivery here is
   * best-effort by design.
   */
  send(message: ClientMessage): void;
}
