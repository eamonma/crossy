// The thin WebSocket implementation of the store's transport port (PROTOCOL.md
// sections 2 and 7). Frames decode through packages/protocol's codec before they
// reach the store; reconnects follow the section 7 backoff schedule (backoff.ts,
// unit-tested); heartbeats go out every 15 seconds (section 9). End-to-end against
// the real session service is Wave 2.2's gate; the unit suite (wsTransport.test.ts)
// covers token resolution and the INV-11 throw-versus-null handling in sendHello.
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
  /**
   * Resolve the identity provider's access token for the next hello. Called fresh
   * before every hello, including each reconnect, so an expired token is never reused:
   * the real path is `identity.getAccessToken()`, which returns the best available token
   * and yields null only on a true sign-out (INV-11). sendHello reads the two failure
   * modes differently: a `null` result is a sign-out, so the transport stops rather than
   * busy-loop a hello the server rejects with UNAUTHORIZED; a thrown rejection is a
   * transient resolution failure (a blip mid-refresh), so the socket drops into the
   * section 7 backoff and a later hello retries.
   */
  getToken: () => Promise<string | null>;
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
      void this.sendHello(socket);
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

    socket.onclose = (event: CloseEvent) => {
      this.stopHeartbeat();
      // One greppable close line (Track D observability): the client half of the disconnect
      // investigation. document.visibilityState distinguishes a background-tab reap from a real
      // drop; guarded so tests and non-browser contexts never touch `document`. Computed before
      // openedAt is zeroed below so the age is the true socket lifetime.
      const socketAgeMs = this.openedAt > 0 ? Date.now() - this.openedAt : 0;
      const visibility =
        typeof document !== "undefined" ? document.visibilityState : "unknown";
      console.info(
        `crossy: socket closed code=${event.code} reason=${JSON.stringify(event.reason)} ` +
          `wasClean=${event.wasClean} socketAgeMs=${socketAgeMs} visibility=${visibility}`,
      );
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

  /**
   * Resolve a fresh token, then send the mandatory first `hello` (PROTOCOL.md section 2)
   * and start heartbeats. Token resolution has two failure modes with opposite handling
   * under INV-11. A `null` token is a true sign-out: stop the transport deliberately
   * rather than loop a hello the server rejects with UNAUTHORIZED, so a signed-out client
   * mid-reconnect settles instead of hammering the endpoint; a later connect (a fresh
   * sign-in re-opens the game) starts a new socket. A thrown rejection is a transient
   * failure (a network blip mid-refresh), not a sign-out: drop this socket so onclose
   * runs the normal reconnect-and-backoff path (PROTOCOL.md sections 7 and 8), never a
   * dead stop. The throw and hello paths guard the socket first: if a successor already
   * replaced this one while the token resolved, they leave the live socket untouched.
   */
  private async sendHello(socket: WebSocket): Promise<void> {
    let token: string | null;
    try {
      token = await this.options.getToken();
    } catch {
      // Transient failure (INV-11): drop this socket into the reconnect-and-backoff
      // walk, matching simulateDrop. The guard keeps a successor socket alive: if a
      // reconnect already replaced this one, `this.socket` is no longer it, so leave
      // the live socket be and let the stale socket's own onclose (already fired) carry
      // the reconnect.
      if (socket === this.socket) socket.close();
      return;
    }
    if (token === null) {
      this.close();
      return;
    }
    if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      encode({ type: "hello", protocolVersion: PROTOCOL_VERSION, token }),
    );
    this.heartbeat = setInterval(() => {
      this.send({ type: "heartbeat" });
    }, HEARTBEAT_INTERVAL_MS);
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
