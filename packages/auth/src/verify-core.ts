// The one claim-check implementation both the Supabase adapter and the in-memory fake
// call (SP2). Keeping it here, parameterized by a `jose` key resolver, is the cohesion
// payoff: the two port implementations differ only in how they source keys (background
// refresh vs. in-process generation), never in how they validate a token. This file
// does no IO of its own — the resolver is fully in-memory — so `verify` is zero-network.

import { decodeProtectedHeader, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import type { AuthFailureReason, VerifyResult } from "./port";

export interface VerifyCoreConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: readonly string[];
  readonly clockToleranceSec: number;
  /** Injected clock (12-factor: no ambient time). Drives `exp`/`nbf`/`iat` checks. */
  readonly now: () => Date;
}

/**
 * Map a `jose` verification error to a typed port failure. Switching on the stable
 * `code` string (not `instanceof`) keeps the mapping robust across module boundaries.
 */
function classify(err: unknown): AuthFailureReason {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return "expired";
    case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
      return "bad-signature";
    // A non-allowlisted algorithm (e.g. HS256) reaching `jose`: refuse as a
    // signature-trust failure. The pre-check below normally catches it first.
    case "ERR_JOSE_ALG_NOT_ALLOWED":
      return "bad-signature";
    case "ERR_JWKS_NO_MATCHING_KEY":
      return "unknown-key";
    case "ERR_JWT_CLAIM_VALIDATION_FAILED": {
      const claim =
        typeof err === "object" && err !== null && "claim" in err
          ? String((err as { claim: unknown }).claim)
          : "";
      if (claim === "iss") return "wrong-issuer";
      if (claim === "aud") return "wrong-audience";
      return "malformed";
    }
    case "ERR_JWS_INVALID":
    case "ERR_JWT_INVALID":
      return "malformed";
    default:
      return "malformed";
  }
}

/**
 * Verify one access token against an in-memory `jose` key resolver, applying SP2's
 * claim checks: asymmetric-only algorithm allowlist (HS256 refused), exact `iss`,
 * `aud === "authenticated"`, `exp`/`nbf` with clock skew, and `sub` present. On success
 * returns `{sub -> userId, is_anonymous -> isAnonymous (default false)}`.
 */
export async function verifyToken(
  resolver: JWTVerifyGetKey,
  token: string,
  config: VerifyCoreConfig,
): Promise<VerifyResult> {
  // Refuse a non-allowlisted algorithm before touching key material. This is the
  // alg-confusion defense (SP2): a forged HS256 token never reaches signature checking.
  // decodeProtectedHeader also rejects structurally broken tokens up front as malformed.
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (alg === undefined || !config.algorithms.includes(alg)) {
    return { ok: false, reason: "bad-signature" };
  }

  try {
    const { payload } = await jwtVerify(token, resolver, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: [...config.algorithms],
      clockTolerance: config.clockToleranceSec,
      currentDate: config.now(),
    });
    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0) {
      return { ok: false, reason: "malformed" };
    }
    return {
      ok: true,
      identity: { userId: sub, isAnonymous: payload["is_anonymous"] === true },
    };
  } catch (err) {
    return { ok: false, reason: classify(err) };
  }
}
