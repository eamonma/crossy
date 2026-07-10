// The WebSocket transport's token handling (PROTOCOL.md section 2 hello; section 7
// reconnect). A fake socket stands in for the browser API through the createSocket
// injection, so no real socket or network is touched. The behavior under test is that
// the transport resolves a fresh token before every hello (an expired token must never
// wedge the reconnect loop) and stops deliberately when the provider returns null.
import { afterEach, describe, expect, it, vi } from "vitest";
import { WsTransport } from "./wsTransport";

/** Flush pending microtasks and any 0 ms timers (the reconnect delay for attempt 0). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A minimal WebSocket stand-in: the transport only uses onopen/onmessage/onclose,
 * send, close, and readyState. */
class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0; // CONNECTING
  readonly sent: string[] = [];
  readonly closedWith: number[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.readyState = 3; // CLOSED
    this.closedWith.push(code ?? 0);
    this.onclose?.();
  }

  /** Drive the open handshake as the browser would. */
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  /** A server-side or transport drop: onclose fires without a deliberate close. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function helloToken(frame: string | undefined): unknown {
  return JSON.parse(frame ?? "{}").token;
}

let live: WsTransport | null = null;

afterEach(() => {
  live?.close();
  live = null;
  vi.restoreAllMocks();
});

function makeTransport(getToken: () => Promise<string | null>): {
  transport: WsTransport;
  sockets: FakeSocket[];
  onConnectionLost: ReturnType<typeof vi.fn>;
} {
  const sockets: FakeSocket[] = [];
  const onConnectionLost = vi.fn();
  const transport = new WsTransport({
    url: "wss://session.test/games/g1/ws",
    getToken,
    onMessage: () => undefined,
    onConnectionLost,
    createSocket: (() => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    }) as unknown as (url: string) => WebSocket,
  });
  live = transport;
  return { transport, sockets, onConnectionLost };
}

describe("ws transport token provider (PROTOCOL.md section 2 hello; section 7 reconnect)", () => {
  it("resolves a fresh token before each hello so a reconnect never reuses an expired one", async () => {
    const tokens = ["token-1", "token-2"];
    let i = 0;
    const { sockets, transport } = makeTransport(() =>
      Promise.resolve(tokens[i++] ?? null),
    );

    transport.connect();
    sockets[0]!.open();
    await flush();
    expect(helloToken(sockets[0]!.sent[0])).toBe("token-1");

    // Drop the socket: the transport backs off (0 ms for attempt 0) and reconnects.
    sockets[0]!.drop();
    await flush();
    expect(sockets).toHaveLength(2);

    sockets[1]!.open();
    await flush();
    // The second hello carries the freshly resolved token, not the first one.
    expect(helloToken(sockets[1]!.sent[0])).toBe("token-2");
  });

  it("stops deliberately when the provider returns null (signed out): no hello, no reconnect, no busy loop", async () => {
    const { sockets, transport, onConnectionLost } = makeTransport(() =>
      Promise.resolve(null),
    );

    transport.connect();
    sockets[0]!.open();
    await flush();

    // No hello was sent, and the socket was closed with the deliberate 1000 code.
    expect(sockets[0]!.sent).toEqual([]);
    expect(sockets[0]!.closedWith).toContain(1000);

    // A deliberate stop: onclose returns early, so no reconnect is scheduled and the
    // store is never told the connection was lost. Advancing timers opens no new socket.
    await flush();
    expect(sockets).toHaveLength(1);
    expect(onConnectionLost).not.toHaveBeenCalled();
  });
});
