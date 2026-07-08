// Dev-mode connect path: wire a GameStore to a real session-service socket. Nothing
// in the test suite requires this; end-to-end against apps/session is Wave 2.2's
// exit gate. The demo boards run on the fake session (src/demo) instead.
import { GameStore } from "../store/gameStore";
import { WsTransport } from "./wsTransport";

export interface GameConnection {
  store: GameStore;
  transport: WsTransport;
  /** Deliberate teardown: closes the socket with no reconnect. */
  close: () => void;
}

export function connectToGame(options: {
  url: string;
  token: string;
}): GameConnection {
  let storeRef: GameStore | null = null;
  const transport = new WsTransport({
    url: options.url,
    token: options.token,
    onMessage: (message) => storeRef?.receive(message),
    onConnectionLost: () => storeRef?.connectionLost(),
  });
  const store = new GameStore({ transport });
  storeRef = store;
  transport.connect();
  return { store, transport, close: () => transport.close() };
}
