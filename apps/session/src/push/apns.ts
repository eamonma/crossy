// The APNs adapter: the edge that carries a Live Activity content-state to Apple over HTTP/2. Node
// builtins ONLY (node:http2 for the transport, node:crypto for the ES256 provider-token JWT); no
// new npm dependency. This file is the only place that talks to Apple, so the fire-and-forget
// isolation (emitter.ts) has one throat to hold.
//
// Provider token (PROTOCOL.md "Live Activity push"; Apple's token-based auth): a JWT signed ES256
// with the team's .p8 key, header {alg:ES256, kid:<key id>}, claims {iss:<team id>, iat:<now>}. It
// is valid ~1h; Apple rejects a token older than that and rate-limits minting a new one more than
// once every ~20 min, so we cache it and refresh at most every MINT_INTERVAL_MS (50 min), safely
// inside the hour and above Apple's floor. One token authenticates every request to either host.
//
// Host selection (PROTOCOL.md "Live Activity push"): a sandbox row (a Debug build's token) MUST go
// to api.sandbox.push.apple.com and a production row to api.push.apple.com. The environment on the
// registry row picks the host; never the wrong one.
//
// Dead set: a 410 Unregistered (or 400 BadDeviceToken) means the token is gone. We add it to an
// in-memory set consulted before every send and never write the registry (the session is SELECT
// only, INV-7); the row ages out of the TTL window on its own.

import { connect } from "node:http2";
import type { ClientHttp2Session } from "node:http2";
import { createSign, createPrivateKey } from "node:crypto";
import type { KeyObject } from "node:crypto";

/** Which Apple host a token was minted for (matches the registry's apns_environment). */
export type ApnsEnvironment = "sandbox" | "production";

const HOSTS: Record<ApnsEnvironment, string> = {
  sandbox: "api.sandbox.push.apple.com",
  production: "api.push.apple.com",
};

/** Refresh the provider JWT at most this often (50 min), inside Apple's ~1h expiry and >20 min floor. */
export const MINT_INTERVAL_MS = 50 * 60 * 1000;

/** APNs listens on 443. Named so the connect call reads clearly. */
const APNS_PORT = 443;

/** The immutable credentials the adapter signs and routes with. Read once from env (main.ts). */
export interface ApnsCredentials {
  readonly teamId: string;
  readonly keyId: string;
  /** The .p8 EC private key, PEM text (APNS_PRIVATE_KEY). */
  readonly privateKeyPem: string;
  /** The app bundle id, a code constant (com.eamonma.Crossy). Drives the apns-topic. */
  readonly bundleId: string;
}

/** One request the adapter delivers: the JSON body, the token, its host, and the push headers. */
export interface ApnsRequest {
  readonly token: string;
  readonly environment: ApnsEnvironment;
  /** apns-priority: 10 immediate (presence, terminal), 5 throttled (fill). */
  readonly priority: 10 | 5;
  /** The serialized APNs envelope (aps.event, aps.timestamp, aps.content-state, ...). */
  readonly body: string;
  /**
   * apns-expiration offset override (seconds). Absent means EXPIRATION_S (a progress frame that
   * cannot land in 30 s is stale noise). The clock push (policy.ts, PROTOCOL.md 12a) sets a longer
   * one: it is a render cause, honest whenever it lands, worth holding for an offline device.
   */
  readonly expirationS?: number;
}

/** The outcome of one send, so the emitter can log-and-drop and the dead set can grow. */
export type ApnsResult =
  | { readonly ok: true; readonly status: number }
  | { readonly ok: false; readonly status: number; readonly dead: boolean }
  | {
      readonly ok: false;
      readonly status: 0;
      readonly dead: false;
      readonly error: string;
    };

/**
 * The HTTP/2 seam. The real adapter binds this to node:http2; tests bind a fake so no request ever
 * leaves the process. One method: send a POST to `:path` on `host` with `headers` and `body`,
 * resolve the response status and the small JSON body APNs returns on an error (the `reason`).
 */
export interface Http2Transport {
  post(
    host: string,
    path: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; body: string }>;
}

/** The clock as data (INV-9 spirit): the adapter never reads Date.now directly, tests inject it. */
export type Clock = () => number;

/**
 * base64url without padding, the JWT segment encoding. Node's "base64url" already omits padding.
 */
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Mint an ES256 provider JWT for APNs. Header {alg:ES256, kid}, claims {iss:teamId, iat:nowSec}.
 * The signature is the JOSE 64-byte r||s form (dsaEncoding ieee-p1363), not DER, which Apple
 * requires. Exposed for the adapter's cache and pinned directly by apns.test.ts.
 */
export function mintProviderToken(
  key: KeyObject,
  keyId: string,
  teamId: string,
  nowSec: number,
): string {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: nowSec }));
  const signingInput = `${header}.${claims}`;
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({ key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

/** Reasons APNs returns that mean the token is permanently gone (add to the dead set). */
const DEAD_REASONS = new Set([
  "Unregistered",
  "BadDeviceToken",
  "DeviceTokenNotForTopic",
]);

/**
 * The APNs adapter. Holds the parsed key, the cached provider token, and the in-memory dead set.
 * `send` skips a dead token, else signs (from the cache), routes to the host for the environment,
 * sets the liveactivity headers, and posts. It maps the response to an ApnsResult and grows the
 * dead set on a 410/400-dead reason. It never throws on a transport fault; it returns a status-0
 * result so the emitter's log-and-drop stays the whole failure story (the island degrades to
 * frozen, never a crash).
 */
export class ApnsAdapter {
  private readonly key: KeyObject;
  private cachedToken: string | null = null;
  private cachedAtMs = 0;
  private readonly dead = new Set<string>();

  constructor(
    private readonly creds: ApnsCredentials,
    private readonly transport: Http2Transport,
    private readonly now: Clock = () => Date.now(),
  ) {
    // Parse the PEM once; a bad key fails loudly here at construction, not per send.
    this.key = createPrivateKey(creds.privateKeyPem);
  }

  /** Whether a token is known dead (410/400); the emitter checks this before building a request. */
  isDead(token: string): boolean {
    return this.dead.has(token);
  }

  /** The current dead-set size, for logs and tests. */
  get deadCount(): number {
    return this.dead.size;
  }

  /** The provider JWT, minted on first use and refreshed at most every MINT_INTERVAL_MS. */
  providerToken(): string {
    const nowMs = this.now();
    if (
      this.cachedToken === null ||
      nowMs - this.cachedAtMs >= MINT_INTERVAL_MS
    ) {
      const nowSec = Math.floor(nowMs / 1000);
      this.cachedToken = mintProviderToken(
        this.key,
        this.creds.keyId,
        this.creds.teamId,
        nowSec,
      );
      this.cachedAtMs = nowMs;
    }
    return this.cachedToken;
  }

  /**
   * The liveactivity header set (PROTOCOL.md "Live Activity push"): the provider-token authorization,
   * the liveactivity apns-topic (`<bundleId>.push-type.liveactivity`), apns-push-type liveactivity,
   * the priority per decision, and a short apns-expiration. Expiration defaults to
   * `now + EXPIRATION_S`: a Live Activity content-state is only worth delivering while it is
   * roughly current, so a frame that cannot land within the window is worthless and should be
   * dropped by APNs rather than queued (stale progress is noise). 30 s matches the fill debounce's
   * neighborhood: a delayed frame is superseded by the next one anyway. A request may override the
   * offset (the clock push, which is a render cause rather than progress and stays honest late).
   */
  private headers(req: ApnsRequest): Record<string, string> {
    const nowSec = Math.floor(this.now() / 1000);
    return {
      ":method": "POST",
      ":path": `/3/device/${req.token}`,
      authorization: `bearer ${this.providerToken()}`,
      "apns-topic": `${this.creds.bundleId}.push-type.liveactivity`,
      "apns-push-type": "liveactivity",
      "apns-priority": String(req.priority),
      "apns-expiration": String(nowSec + (req.expirationS ?? EXPIRATION_S)),
    };
  }

  /**
   * Deliver one request. A dead token is a no-op (returns ok:false, dead:true, status 410 so the
   * caller logs it uniformly). A transport fault returns a status-0 result and never throws. A 410
   * or a 400 whose reason is a dead-token reason adds the token to the dead set.
   */
  async send(req: ApnsRequest): Promise<ApnsResult> {
    if (this.dead.has(req.token)) {
      return { ok: false, status: 410, dead: true };
    }
    const host = HOSTS[req.environment];
    const headers = this.headers(req);
    let response: { status: number; body: string };
    try {
      response = await this.transport.post(
        host,
        headers[":path"]!,
        headers,
        req.body,
      );
    } catch (error) {
      return {
        ok: false,
        status: 0,
        dead: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status };
    }
    const dead = this.isDeadResponse(response.status, response.body);
    if (dead) this.dead.add(req.token);
    return { ok: false, status: response.status, dead };
  }

  /** A 410 is always dead; a 400 is dead only when its `reason` is a dead-token reason. */
  private isDeadResponse(status: number, body: string): boolean {
    if (status === 410) return true;
    if (status !== 400) return false;
    const reason = parseReason(body);
    return reason !== null && DEAD_REASONS.has(reason);
  }
}

/** apns-expiration offset (seconds): a content-state that cannot land in 30 s is stale, drop it. */
export const EXPIRATION_S = 30;

/** Pull the `reason` string from an APNs error body `{ "reason": "Unregistered" }`; null if absent. */
function parseReason(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { reason?: unknown }).reason === "string"
    ) {
      return (parsed as { reason: string }).reason;
    }
  } catch {
    // A non-JSON body carries no reason; treat as not-dead (the status alone decides).
  }
  return null;
}

/**
 * The real HTTP/2 transport over node:http2. One session per host, opened lazily and reused across
 * requests (APNs wants a long-lived multiplexed connection, not a connection per push). A dropped
 * session is discarded and reopened on the next send. This lives at the very edge; the emitter's
 * isolation queue keeps a slow open or a drop off the actor's hot path.
 */
export function createHttp2Transport(): Http2Transport {
  const sessions = new Map<string, ClientHttp2Session>();

  function sessionFor(host: string): ClientHttp2Session {
    const existing = sessions.get(host);
    if (existing !== undefined && !existing.closed && !existing.destroyed) {
      return existing;
    }
    const session = connect(`https://${host}:${APNS_PORT}`);
    session.on("error", () => {
      // Drop the broken session; the next send reopens. Never throw out of the event handler.
      sessions.delete(host);
    });
    sessions.set(host, session);
    return session;
  }

  return {
    post(host, path, headers, body) {
      return new Promise((resolve, reject) => {
        let session: ClientHttp2Session;
        try {
          session = sessionFor(host);
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        const req = session.request({ ...headers, ":path": path });
        let status = 0;
        const chunks: Buffer[] = [];
        req.on("response", (h) => {
          status = Number(h[":status"] ?? 0);
        });
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () =>
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") }),
        );
        req.on("error", (error) => reject(error));
        req.end(body);
      });
    },
  };
}
