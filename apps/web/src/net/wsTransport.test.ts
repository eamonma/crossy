// The WebSocket transport's token handling (PROTOCOL.md section 2 hello; section 7
// reconnect). A fake socket stands in for the browser API through the createSocket
// injection, so no real socket or network is touched. The behavior under test is that
// the transport resolves a fresh token before every hello (an expired token must never
// wedge the reconnect loop) and, under INV-11, reads a null token as a true sign-out
// (deliberate stop) but a thrown resolution as a transient failure (drop into backoff
// and retry the hello), never acting on a socket a successor has already replaced.
import { afterEach, describe, expect, it, vi } from "vitest";
import { WsTransport } from "./wsTransport";

/** Flush pending microtasks and any 0 ms timers (the reconnect delay for attempt 0). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A minimal WebSocket stand-in: the transport only uses onopen/onmessage/onclose,
 * send, close, and readyState. onclose receives a CloseEvent-shaped object, as the browser
 * delivers, so the transport can read code/reason/wasClean for its Track D close log. */
class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readyState = 0; // CONNECTING
  readonly sent: string[] = [];
  readonly closedWith: number[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number): void {
    this.readyState = 3; // CLOSED
    this.closedWith.push(code ?? 0);
    this.fireClose(code ?? 0, true);
  }

  /** Drive the open handshake as the browser would. */
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }

  /** A server-side or transport drop: onclose fires without a deliberate close. */
  drop(code = 1006): void {
    this.readyState = 3;
    this.fireClose(code, false);
  }

  private fireClose(code: number, wasClean: boolean): void {
    this.onclose?.({ code, reason: "", wasClean } as CloseEvent);
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

/** A getToken whose resolutions are settled by the test, one deferred per call, so the
 * suite can interleave a token landing with a socket having already been replaced. */
function deferredTokens(): {
  getToken: () => Promise<string | null>;
  deferreds: Array<{
    resolve: (token: string | null) => void;
    reject: (reason: unknown) => void;
  }>;
} {
  const deferreds: Array<{
    resolve: (token: string | null) => void;
    reject: (reason: unknown) => void;
  }> = [];
  const getToken = () =>
    new Promise<string | null>((resolve, reject) => {
      deferreds.push({ resolve, reject });
    });
  return { getToken, deferreds };
}

describe("INV-11: sessions outlive access tokens (a transient token failure is not a sign-out)", () => {
  it("INV-11: a thrown token drops the socket into backoff and the retried hello lands, never a dead stop", async () => {
    let call = 0;
    const { sockets, transport, onConnectionLost } = makeTransport(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new Error("network blip mid-refresh"))
        : Promise.resolve("token-after-retry");
    });

    transport.connect();
    sockets[0]!.open();
    await flush();

    // The throw dropped the socket without a hello and without the deliberate 1000 code,
    // so onclose ran the transport-drop path: the store hears the connection was lost.
    expect(sockets[0]!.sent).toEqual([]);
    expect(sockets[0]!.closedWith).not.toContain(1000);
    expect(onConnectionLost).toHaveBeenCalledTimes(1);

    // Backoff (0 ms for attempt 0) reconnects rather than leaving the game dead.
    await flush();
    expect(sockets).toHaveLength(2);

    sockets[1]!.open();
    await flush();
    // The retry resolves a token and delivers the hello: the connection is alive again.
    expect(helloToken(sockets[1]!.sent[0])).toBe("token-after-retry");
  });

  it("INV-11: a null token is a true sign-out: deliberate stop, no reconnect timer, no hello", async () => {
    const { sockets, transport, onConnectionLost } = makeTransport(() =>
      Promise.resolve(null),
    );

    transport.connect();
    sockets[0]!.open();
    await flush();

    // Deliberate teardown: the 1000 close code, no hello frame.
    expect(sockets[0]!.sent).toEqual([]);
    expect(sockets[0]!.closedWith).toContain(1000);

    // No reconnect is scheduled and the store is never told the connection was lost;
    // letting timers run opens no successor socket.
    await flush();
    expect(sockets).toHaveLength(1);
    expect(onConnectionLost).not.toHaveBeenCalled();
  });

  it("INV-11: a token resolving after a successor replaced the socket never acts on the stale socket", async () => {
    const { getToken, deferreds } = deferredTokens();
    const { sockets, transport } = makeTransport(getToken);

    transport.connect();
    sockets[0]!.open(); // sendHello(sockets[0]) now awaits deferreds[0]
    await flush();
    expect(deferreds).toHaveLength(1);

    // The first socket drops before its token settles; onclose schedules a reconnect.
    sockets[0]!.drop();
    await flush(); // the 0 ms reconnect timer fires and opens the successor
    expect(sockets).toHaveLength(2);

    sockets[1]!.open(); // sendHello(sockets[1]) now awaits deferreds[1]
    await flush();
    expect(deferreds).toHaveLength(2);

    // The stale socket's token finally rejects. The guard sees sockets[0] is no longer
    // the live socket, so the successor is left untouched: not closed, still open.
    deferreds[0]!.reject(new Error("network blip mid-refresh"));
    await flush();
    expect(sockets[1]!.closedWith).toEqual([]);
    expect(sockets[1]!.readyState).toBe(1); // OPEN

    // The live socket completes its own hello once its own token resolves.
    deferreds[1]!.resolve("token-live");
    await flush();
    expect(helloToken(sockets[1]!.sent[0])).toBe("token-live");
  });
});

describe("Track D observability: the transport logs one greppable line on every socket close", () => {
  it("logs the close code, wasClean flag, and socket age on a transport drop", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { sockets, transport } = makeTransport(() => Promise.resolve("t1"));

    transport.connect();
    sockets[0]!.open();
    await flush();

    // A 1006 transport drop (the Railway edge reap this whole track chases): one close line.
    sockets[0]!.drop(1006);

    const line = info.mock.calls.find(
      (c) =>
        typeof c[0] === "string" && c[0].startsWith("crossy: socket closed"),
    );
    expect(line).toBeDefined();
    expect(line![0]).toContain("code=1006");
    expect(line![0]).toContain("wasClean=false");
    expect(line![0]).toContain("socketAgeMs=");
    // Non-browser test context: the document guard keeps visibility inert, never a crash.
    expect(line![0]).toContain("visibility=unknown");
  });
});
