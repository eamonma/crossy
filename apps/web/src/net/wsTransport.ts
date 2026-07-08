// The thin WebSocket implementation of the store's transport port (PROTOCOL.md
// sections 2 and 7). Frames decode through packages/protocol's codec before they
// reach the store; reconnects follow the section 7 backoff schedule (backoff.ts,
// unit-tested); heartbeats go out every 15 seconds (section 9). End-to-end against
// the real session service is Wave 2.2's gate; nothing in the test suite requires
// this module.
import {
  PROTOCOL_VERSION,
  decodeServerMessage,
  encode,
} from "@crossy/protocol";
import type { ClientMessage, ServerMessage } from "@crossy/protocol";
import type { GameTransport } from "../store/transport";
import { BackoffSchedule } from "./backoff";

const HEARTBEAT_INTERVAL_MS = 15_000; // PROTOCOL.md section 9

export interface WsTransportOptions {
  /** wss://{session-host}/games/{gameId}/ws (PROTOCOL.md section 2). */
  url: string;
  /** The identity provider's access token, sent in hello. */
  token: string;
  /** A codec-decoded frame arrived; typically store.receive. */
  onMessage: (message: ServerMessage) => void;
  /** The socket dropped; typically store.connectionLost. Reconnection is internal. */
  onConnectionLost: () => void;
  /** Injectable for tests and non-browser contexts; defaults to the browser API. */
  createSocket?: (url: string) => WebSocket;
}

export class WsTransport implements GameTransport {
  private readonly options: WsTransportOptions;
  private readonly schedule = new BackoffSchedule();
  private socket: WebSocket | null = null;
  private openedAt = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedDeliberately = false;

  constructor(options: WsTransportOptions) {
    this.options = options;
  }

  connect(): void {
    this.closedDeliberately = false;
    const create =
      this.options.createSocket ?? ((url: string) => new WebSocket(url));
    const socket = create(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      this.openedAt = Date.now();
      // The first frame MUST be hello (PROTOCOL.md section 2).
      socket.send(
        encode({
          type: "hello",
          protocolVersion: PROTOCOL_VERSION,
          token: this.options.token,
        }),
      );
      this.heartbeat = setInterval(() => {
        this.send({ type: "heartbeat" });
      }, HEARTBEAT_INTERVAL_MS);
    };

    socket.onmessage = (event: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        console.warn("crossy: dropped a non-JSON frame");
        return;
      }
      const decoded = decodeServerMessage(raw);
      if (!decoded.ok) {
        // Unknown notice types: ignore and log (PROTOCOL.md section 3).
        console.warn(`crossy: dropped a frame (${decoded.error.detail})`);
        return;
      }
      this.options.onMessage(decoded.value);
    };

    socket.onclose = () => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.closedDeliberately) return;
      // Both fatal-error closes (1008) and transport drops land here; the store is
      // already or now becomes `reconnecting` and keeps its overlay (section 7).
      // Only report survival when this socket actually opened: a failed reconnect
      // attempt (server still down) never opened, so it must not reset the backoff
      // walk, or a long-lived drop would busy-loop at 0 ms against a dead server.
      if (this.openedAt > 0) {
        this.schedule.connectionSurvived(Date.now() - this.openedAt);
        this.openedAt = 0;
      }
      this.options.onConnectionLost();
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, this.schedule.nextDelayMs());
    };
  }

  /** Best-effort send: with no open socket the frame drops, and the overlay plus
   * snapshot reconciliation recover any mutation (PROTOCOL.md section 8). */
  send(message: ClientMessage): void {
    if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(encode(message));
  }

  /** Deliberate teardown: no reconnect. */
  close(): void {
    this.closedDeliberately = true;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.socket?.close(1000);
    this.socket = null;
  }

  /**
   * Drop the live socket without tearing the transport down, so `onclose` runs the normal
   * reconnect-and-resync path (PROTOCOL.md sections 7 and 8). This is the smoke test's
   * "kill the socket mid-word" hook; it is never used by the store or the demo.
   */
  simulateDrop(): void {
    this.socket?.close();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
