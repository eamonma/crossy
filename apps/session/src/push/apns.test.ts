// APNs adapter tests (PROTOCOL.md "Live Activity push"). A fake Http2Transport captures every
// request, so nothing ever hits Apple. These pin the provider-token JWT shape (ES256, kid header,
// iss/iat claims), host selection per environment, the liveactivity header set, and the 410/400
// dead-set behavior. Test names cite the section they defend.

import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApnsAdapter,
  EXPIRATION_S,
  MINT_INTERVAL_MS,
  mintProviderToken,
} from "./apns";
import type { ApnsCredentials, Http2Transport } from "./apns";

// A throwaway P-256 keypair; the private key signs, the public key verifies the JWT in-test.
const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const privateKeyPem = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

const CREDS: ApnsCredentials = {
  teamId: "TEAM123456",
  keyId: "KEY7654321",
  privateKeyPem,
  bundleId: "com.eamonma.Crossy",
};

interface CapturedRequest {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

/** A fake transport that records requests and returns a scripted response. */
function fakeTransport(
  respond: (req: CapturedRequest) => { status: number; body: string },
): { transport: Http2Transport; sent: CapturedRequest[] } {
  const sent: CapturedRequest[] = [];
  const transport: Http2Transport = {
    async post(host, path, headers, body) {
      const req = { host, path, headers, body };
      sent.push(req);
      return respond(req);
    },
  };
  return { transport, sent };
}

function decodeSegment(seg: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

describe("APNs JWT: ES256 provider token shape (PROTOCOL.md Live Activity push)", () => {
  it("carries alg ES256 and the kid in the header, iss and iat in the claims", () => {
    const token = mintProviderToken(
      privateKey,
      CREDS.keyId,
      CREDS.teamId,
      1_700_000_000,
    );
    const [h, c] = token.split(".");
    const header = decodeSegment(h!);
    const claims = decodeSegment(c!);
    expect(header).toEqual({ alg: "ES256", kid: "KEY7654321" });
    expect(claims).toEqual({ iss: "TEAM123456", iat: 1_700_000_000 });
  });

  it("signs with ES256 so the team's public key verifies it (64-byte P1363 sig)", () => {
    const token = mintProviderToken(privateKey, CREDS.keyId, CREDS.teamId, 42);
    const [h, c, sig] = token.split(".");
    const verified = createVerify("SHA256")
      .update(`${h}.${c}`)
      .verify(
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(sig!, "base64url"),
      );
    expect(verified).toBe(true);
    // JOSE ES256 signature is 64 bytes (r||s), not DER.
    expect(Buffer.from(sig!, "base64url")).toHaveLength(64);
  });

  it("caches the token and refreshes at most every MINT_INTERVAL_MS (50 min)", () => {
    let nowMs = 1_000_000;
    const { transport } = fakeTransport(() => ({ status: 200, body: "" }));
    const adapter = new ApnsAdapter(CREDS, transport, () => nowMs);
    const first = adapter.providerToken();
    nowMs += MINT_INTERVAL_MS - 1;
    expect(adapter.providerToken()).toBe(first); // still inside the window
    nowMs += 2;
    expect(adapter.providerToken()).not.toBe(first); // window elapsed, re-minted
  });
});

describe("APNs host selection per environment (never the wrong host)", () => {
  it("routes a sandbox token to the sandbox host and a production token to production", async () => {
    const { transport, sent } = fakeTransport(() => ({
      status: 200,
      body: "",
    }));
    const adapter = new ApnsAdapter(CREDS, transport);
    await adapter.send({
      token: "t1",
      environment: "sandbox",
      priority: 5,
      body: "{}",
    });
    await adapter.send({
      token: "t2",
      environment: "production",
      priority: 5,
      body: "{}",
    });
    expect(sent[0]!.host).toBe("api.sandbox.push.apple.com");
    expect(sent[1]!.host).toBe("api.push.apple.com");
  });
});

describe("APNs header set (PROTOCOL.md Live Activity push)", () => {
  it("sets topic, push-type, priority, expiration, and the provider-token authorization", async () => {
    const nowMs = 1_700_000_000_000;
    const { transport, sent } = fakeTransport(() => ({
      status: 200,
      body: "",
    }));
    const adapter = new ApnsAdapter(CREDS, transport, () => nowMs);
    await adapter.send({
      token: "tok",
      environment: "production",
      priority: 10,
      body: "{}",
    });
    const h = sent[0]!.headers;
    expect(h[":method"]).toBe("POST");
    expect(h[":path"]).toBe("/3/device/tok");
    expect(h["apns-topic"]).toBe("com.eamonma.Crossy.push-type.liveactivity");
    expect(h["apns-push-type"]).toBe("liveactivity");
    expect(h["apns-priority"]).toBe("10");
    expect(h["apns-expiration"]).toBe(
      String(Math.floor(nowMs / 1000) + EXPIRATION_S),
    );
    expect(h["authorization"]).toMatch(/^bearer .+\..+\..+$/);
  });

  it("a request's expirationS overrides the default offset (the clock push stays honest late)", async () => {
    const nowMs = 1_700_000_000_000;
    const { transport, sent } = fakeTransport(() => ({
      status: 200,
      body: "",
    }));
    const adapter = new ApnsAdapter(CREDS, transport, () => nowMs);
    await adapter.send({
      token: "tok",
      environment: "production",
      priority: 10,
      body: "{}",
      expirationS: 3600,
    });
    expect(sent[0]!.headers["apns-expiration"]).toBe(
      String(Math.floor(nowMs / 1000) + 3600),
    );
  });
});

describe("APNs dead-set: 410/400 tokens are dropped before future sends (INV-7: no registry write)", () => {
  it("adds a 410 Unregistered token to the dead set and short-circuits the next send", async () => {
    let calls = 0;
    const { transport, sent } = fakeTransport(() => {
      calls++;
      return { status: 410, body: JSON.stringify({ reason: "Unregistered" }) };
    });
    const adapter = new ApnsAdapter(CREDS, transport);
    const first = await adapter.send({
      token: "dead",
      environment: "sandbox",
      priority: 5,
      body: "{}",
    });
    expect(first).toMatchObject({ ok: false, status: 410, dead: true });
    expect(adapter.isDead("dead")).toBe(true);
    // A second send to the same token never reaches the transport.
    const second = await adapter.send({
      token: "dead",
      environment: "sandbox",
      priority: 5,
      body: "{}",
    });
    expect(second).toMatchObject({ ok: false, status: 410, dead: true });
    expect(sent).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it("treats a 400 BadDeviceToken as dead, but a 400 with another reason as live", async () => {
    const { transport } = fakeTransport((req) => {
      if (req.headers[":path"]!.endsWith("/badtoken")) {
        return {
          status: 400,
          body: JSON.stringify({ reason: "BadDeviceToken" }),
        };
      }
      return {
        status: 400,
        body: JSON.stringify({ reason: "PayloadTooLarge" }),
      };
    });
    const adapter = new ApnsAdapter(CREDS, transport);
    await adapter.send({
      token: "badtoken",
      environment: "sandbox",
      priority: 5,
      body: "{}",
    });
    await adapter.send({
      token: "other",
      environment: "sandbox",
      priority: 5,
      body: "{}",
    });
    expect(adapter.isDead("badtoken")).toBe(true);
    expect(adapter.isDead("other")).toBe(false);
  });

  it("a 2xx is ok and never dead", async () => {
    const { transport } = fakeTransport(() => ({ status: 200, body: "" }));
    const adapter = new ApnsAdapter(CREDS, transport);
    const r = await adapter.send({
      token: "ok",
      environment: "production",
      priority: 10,
      body: "{}",
    });
    expect(r).toEqual({ ok: true, status: 200 });
    expect(adapter.isDead("ok")).toBe(false);
  });

  it("a transport fault returns a status-0 result and never throws (fire-and-forget safety)", async () => {
    const transport: Http2Transport = {
      async post() {
        throw new Error("connection reset");
      },
    };
    const adapter = new ApnsAdapter(CREDS, transport);
    const r = await adapter.send({
      token: "x",
      environment: "sandbox",
      priority: 5,
      body: "{}",
    });
    expect(r).toMatchObject({ ok: false, status: 0 });
    expect("error" in r && r.error).toBe("connection reset");
  });
});
