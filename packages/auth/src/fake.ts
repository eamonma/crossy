// The in-memory fake identity provider (SP2). It generates its own ES256 keypair,
// signs test tokens, publishes the matching JWKS, and verifies through the same core as
// the real adapter. It is part of this package's public API so both services' test
// suites can mint and verify tokens with no Docker and no network — the decoupling
// payoff: a service test depends on `AuthPort` and this fake, never on a live Supabase.

import type { webcrypto } from "node:crypto";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import type { JSONWebKeySet, JWK } from "jose";
import {
  DEFAULT_ALGORITHMS,
  DEFAULT_ANONYMOUS_CLAIM,
  DEFAULT_AUDIENCE,
  DEFAULT_CLOCK_TOLERANCE_SEC,
} from "./port";
import type { AuthPort, VerifyResult } from "./port";
import { verifyToken } from "./verify-core";

/** The WebCrypto private key `generateKeyPair` yields; named via node to avoid the DOM lib. */
type SigningPrivateKey = webcrypto.CryptoKey;

const FAKE_ISSUER = "https://fake-auth.crossy.test/auth/v1";

/**
 * Claim/signing overrides for a minted token. Omit a field to accept its default; every
 * time offset is relative to the provider's injected clock so expiry tests are
 * deterministic.
 */
export interface MintOptions {
  /** JWT `sub` -> `userId`. Defaults to a fresh random UUID. */
  readonly sub?: string;
  /** The `is_anonymous` claim. Defaults to `false`. */
  readonly isAnonymous?: boolean;
  /** Drop the `is_anonymous` claim entirely (a permanent user may omit it). */
  readonly omitAnonymousClaim?: boolean;
  /** Override the issuer (to exercise the wrong-issuer path). Defaults to the provider's issuer. */
  readonly issuer?: string;
  /** Override the audience (to exercise the wrong-audience path). Defaults to `authenticated`. */
  readonly audience?: string;
  /** Seconds from now until `exp`. Defaults to +3600. Negative mints an expired token. */
  readonly expSecondsFromNow?: number;
  /** Seconds from now for `nbf`. Omitted by default (no `nbf` claim). */
  readonly nbfSecondsFromNow?: number;
  /** Seconds from now for `iat`. Defaults to 0. */
  readonly iatSecondsFromNow?: number;
}

export interface FakeAuthConfig {
  readonly issuer?: string;
  readonly audience?: string;
  readonly algorithms?: readonly string[];
  readonly clockToleranceSec?: number;
  /** Injected clock (12-factor). Defaults to the wall clock. */
  readonly now?: () => Date;
  /**
   * The claim name the fake writes the anonymity flag into and reads back on verify.
   * Defaults to `is_anonymous` (GoTrue's convention). Set it to exercise a custom claim.
   */
  readonly anonymousClaim?: string;
}

/**
 * The fake identity provider: an `AuthPort` that also mints the tokens it verifies and
 * publishes its JWKS (so the real adapter can be pointed at it in tests).
 */
export interface FakeAuthProvider extends AuthPort {
  /** The published JWK Set: the public half of every non-revoked key. */
  jwks(): JSONWebKeySet;
  /** The JWKS URL derived from this provider's issuer (to wire an adapter's `fetchJwks`). */
  jwksUri(): string;
  /** The `kid` currently signing new tokens. */
  currentKid(): string;
  /**
   * Rotate: publish a new signing key and demote the old one to verify-only (it stays in
   * the JWKS until revoked). Models Supabase's standby -> current -> previously-used
   * overlap (SP2). Returns the new `kid`.
   */
  rotate(): Promise<string>;
  /** Drop a key from the JWKS (models revoke). Tokens signed by it then fail unknown-key. */
  revokeKey(kid: string): void;

  /** Mint a valid token signed by the current key. */
  mint(opts?: MintOptions): Promise<string>;
  /** Mint an anonymous token (`is_anonymous: true`). */
  mintAnonymous(opts?: MintOptions): Promise<string>;
  /** Mint an expired token (default `exp` = 1 hour ago, well past any skew). */
  mintExpired(opts?: MintOptions): Promise<string>;
  /** Mint a permanent-user token (`is_anonymous: false`). */
  mintUpgraded(opts?: MintOptions): Promise<string>;
  /**
   * Mint the one-token-lifetime lag from SP1: a just-upgraded guest whose still-valid
   * pre-upgrade token carries `is_anonymous: true`. `verify` faithfully reports `true`,
   * so the API's JIT upsert must tolerate the flag flipping late (SP1, DESIGN.md §8).
   */
  mintUnrefreshedUpgrade(opts?: MintOptions): Promise<string>;
  /** Mint a token whose `kid` is not in the published JWKS (fails unknown-key). */
  mintUnknownKid(opts?: MintOptions): Promise<string>;
  /** Mint a token with a published `kid` but signed by a foreign key (fails bad-signature). */
  mintBadSignature(opts?: MintOptions): Promise<string>;
  /** Mint a legacy HS256 token (the static-key family SP2 says the port must refuse). */
  mintHs256(opts?: MintOptions): Promise<string>;
}

interface SigningKey {
  readonly kid: string;
  readonly privateKey: SigningPrivateKey;
  readonly publicJwk: JWK;
}

async function generateSigningKey(): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", {
    extractable: true,
  });
  const kid = crypto.randomUUID();
  const jwk = await exportJWK(publicKey);
  return {
    kid,
    privateKey,
    publicJwk: { ...jwk, kid, alg: "ES256", use: "sig", key_ops: ["verify"] },
  };
}

/** Construct an in-memory fake identity provider with one freshly generated ES256 key. */
export async function createFakeAuthProvider(
  config: FakeAuthConfig = {},
): Promise<FakeAuthProvider> {
  const issuer = config.issuer ?? FAKE_ISSUER;
  const audience = config.audience ?? DEFAULT_AUDIENCE;
  const algorithms = config.algorithms ?? DEFAULT_ALGORITHMS;
  const clockToleranceSec =
    config.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC;
  const now = config.now ?? (() => new Date());
  const anonymousClaim = config.anonymousClaim ?? DEFAULT_ANONYMOUS_CLAIM;

  const coreConfig = {
    issuer,
    audience,
    algorithms,
    clockToleranceSec,
    now,
    anonymousClaim,
  };

  let keys: SigningKey[] = [await generateSigningKey()];
  let signerKid = keys[0]!.kid;

  const jwks = (): JSONWebKeySet => ({ keys: keys.map((k) => k.publicJwk) });
  const currentSigner = (): SigningKey => {
    const k = keys.find((key) => key.kid === signerKid);
    if (k === undefined)
      throw new Error("fake provider has no active signing key");
    return k;
  };

  async function sign(
    kid: string,
    key: SigningPrivateKey,
    opts: MintOptions,
  ): Promise<string> {
    const nowSec = Math.floor(now().getTime() / 1000);
    const payload: Record<string, unknown> = { role: "authenticated" };
    if (opts.omitAnonymousClaim !== true) {
      payload[anonymousClaim] = opts.isAnonymous ?? false;
    }
    const jwt = new SignJWT(payload)
      .setProtectedHeader({ alg: "ES256", kid })
      .setSubject(opts.sub ?? crypto.randomUUID())
      .setIssuer(opts.issuer ?? issuer)
      .setAudience(opts.audience ?? audience)
      .setIssuedAt(nowSec + (opts.iatSecondsFromNow ?? 0))
      .setExpirationTime(nowSec + (opts.expSecondsFromNow ?? 3600));
    if (opts.nbfSecondsFromNow !== undefined) {
      jwt.setNotBefore(nowSec + opts.nbfSecondsFromNow);
    }
    return jwt.sign(key);
  }

  return {
    verify(token: string): Promise<VerifyResult> {
      return verifyToken(createLocalJWKSet(jwks()), token, coreConfig);
    },
    jwks,
    jwksUri: () => `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`,
    currentKid: () => signerKid,
    async rotate(): Promise<string> {
      const next = await generateSigningKey();
      keys = [...keys, next];
      signerKid = next.kid;
      return next.kid;
    },
    revokeKey(kid: string): void {
      keys = keys.filter((k) => k.kid !== kid);
    },

    mint(opts: MintOptions = {}): Promise<string> {
      const signer = currentSigner();
      return sign(signer.kid, signer.privateKey, opts);
    },
    mintAnonymous(opts: MintOptions = {}): Promise<string> {
      const signer = currentSigner();
      return sign(signer.kid, signer.privateKey, {
        ...opts,
        isAnonymous: true,
      });
    },
    mintExpired(opts: MintOptions = {}): Promise<string> {
      const signer = currentSigner();
      return sign(signer.kid, signer.privateKey, {
        expSecondsFromNow: -3600,
        ...opts,
      });
    },
    mintUpgraded(opts: MintOptions = {}): Promise<string> {
      const signer = currentSigner();
      return sign(signer.kid, signer.privateKey, {
        ...opts,
        isAnonymous: false,
      });
    },
    mintUnrefreshedUpgrade(opts: MintOptions = {}): Promise<string> {
      const signer = currentSigner();
      return sign(signer.kid, signer.privateKey, {
        ...opts,
        isAnonymous: true,
      });
    },
    async mintUnknownKid(opts: MintOptions = {}): Promise<string> {
      const foreign = await generateSigningKey(); // never added to `keys`, so unpublished
      return sign(foreign.kid, foreign.privateKey, opts);
    },
    async mintBadSignature(opts: MintOptions = {}): Promise<string> {
      const foreign = await generateSigningKey();
      // Published `kid`, foreign private key: the resolver finds a key, the signature fails.
      return sign(currentSigner().kid, foreign.privateKey, opts);
    },
    async mintHs256(opts: MintOptions = {}): Promise<string> {
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const nowSec = Math.floor(now().getTime() / 1000);
      const payload: Record<string, unknown> = {
        role: "authenticated",
        [anonymousClaim]: opts.isAnonymous ?? false,
      };
      return new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(opts.sub ?? crypto.randomUUID())
        .setIssuer(opts.issuer ?? issuer)
        .setAudience(opts.audience ?? audience)
        .setIssuedAt(nowSec + (opts.iatSecondsFromNow ?? 0))
        .setExpirationTime(nowSec + (opts.expSecondsFromNow ?? 3600))
        .sign(secret);
    },
  };
}
