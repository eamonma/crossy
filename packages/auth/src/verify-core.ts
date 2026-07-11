// The one claim-check implementation both the JWKS adapter and the in-memory fake
// call (SP2). Keeping it here, parameterized by a `jose` key resolver, is the cohesion
// payoff: the two port implementations differ only in how they source keys (background
// refresh vs. in-process generation), never in how they validate a token. This file
// does no IO of its own — the resolver is fully in-memory — so `verify` is zero-network.

import { createHash } from "node:crypto";
import { decodeProtectedHeader, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { GRAVATAR_BASE_URL } from "./port";
import type { AuthFailureReason, VerifyResult } from "./port";

export interface VerifyCoreConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithms: readonly string[];
  readonly clockToleranceSec: number;
  /** Injected clock (12-factor: no ambient time). Drives `exp`/`nbf`/`iat` checks. */
  readonly now: () => Date;
  /**
   * The claim name whose truthy value maps to `isAnonymous`. The port configs default it
   * to `is_anonymous` (GoTrue's convention); read from config here so the core carries no
   * single vendor's claim vocabulary.
   */
  readonly anonymousClaim: string;
  /**
   * The claim name of the metadata object the display name is read from. The port configs
   * default it to `user_metadata` (GoTrue's convention); read from config so the core carries
   * no single vendor's claim vocabulary.
   */
  readonly metadataClaim: string;
  /**
   * Candidate keys inside the metadata object, in priority order. The first key whose value is
   * a non-empty string maps to `displayName`; an exhausted list resolves to `null`. The port
   * configs default it to `full_name`, `name`, `user_name`, `preferred_username`.
   */
  readonly nameKeys: readonly string[];
  /**
   * Candidate keys inside the metadata object for a provider avatar, in priority order. The first
   * key whose value is a non-empty string is taken verbatim as `avatarUrl`; an exhausted list falls
   * through to the Gravatar derivation. The port configs default it to `avatar_url`, `picture`.
   */
  readonly avatarKeys: readonly string[];
  /**
   * The top-level claim name carrying the account email, read only to derive a Gravatar URL when no
   * provider avatar is present. The email is hashed here and never returned. The port configs
   * default it to `email`.
   */
  readonly emailClaim: string;
}

/**
 * Lift the display name from the token's metadata claim. Returns the first candidate key whose
 * value is a non-empty string (non-string or empty values are skipped), or `null` when the
 * claim is absent, not an object, or carries no usable name (DESIGN.md §8).
 */
function extractDisplayName(
  payload: Record<string, unknown>,
  metadataClaim: string,
  nameKeys: readonly string[],
): string | null {
  const meta = payload[metadataClaim];
  if (typeof meta !== "object" || meta === null) return null;
  const record = meta as Record<string, unknown>;
  for (const key of nameKeys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/**
 * Read a top-level string claim, or `null` when it is absent, not a string, or empty after trim.
 */
function readStringClaim(
  payload: Record<string, unknown>,
  claim: string,
): string | null {
  const value = payload[claim];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Resolve the avatar URL from the token (DESIGN.md §8), in priority order: a provider avatar from
 * the metadata claim (Discord's `avatar_url`, OIDC `picture`), else a Gravatar URL derived from the
 * account email, else `null`.
 *
 * The Gravatar hash is the MD5 of the email lowercased and trimmed (ASCII-only lowercasing, INV-1,
 * so the two ports agree), per Gravatar's spec, with `d=404` so an absent Gravatar returns a 404
 * the client treats as absent (PROTOCOL.md §4). The email is hashed here and discarded: it is never
 * returned on the identity and so never crosses a service boundary or the wire (INV-6 spirit).
 */
function resolveAvatarUrl(
  payload: Record<string, unknown>,
  metadataClaim: string,
  avatarKeys: readonly string[],
  emailClaim: string,
): string | null {
  const meta = payload[metadataClaim];
  if (typeof meta === "object" && meta !== null) {
    const record = meta as Record<string, unknown>;
    for (const key of avatarKeys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value;
    }
  }
  // No provider avatar: fall back to Gravatar from the email. The email is a hash input only.
  const email =
    readStringClaim(payload, emailClaim) ??
    (typeof meta === "object" && meta !== null
      ? readStringClaim(meta as Record<string, unknown>, emailClaim)
      : null);
  if (email === null) return null;
  // ASCII-only lowercasing (INV-1): map A-Z to a-z, leave every other code point unchanged, so the
  // TS and Swift ports hash byte-identically. The email never reaches locale-aware casing.
  const normalized = email.trim().replace(/[A-Z]/g, (c) => c.toLowerCase());
  const hash = createHash("md5").update(normalized).digest("hex");
  return `${GRAVATAR_BASE_URL}/${hash}?d=404`;
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
 * claim checks: asymmetric-only algorithm allowlist (HS256 refused), exact `iss`, `aud`
 * equal to the configured audience, `exp`/`nbf` with clock skew, and `sub` present. On
 * success returns `{ sub -> userId, config.anonymousClaim -> isAnonymous (default false),
 * config.metadataClaim[config.nameKeys] -> displayName (default null), avatarUrl resolved from the
 * provider avatar or a Gravatar URL over the email (default null; the email is hashed here and
 * never returned) }`.
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
      identity: {
        userId: sub,
        isAnonymous: payload[config.anonymousClaim] === true,
        displayName: extractDisplayName(
          payload,
          config.metadataClaim,
          config.nameKeys,
        ),
        avatarUrl: resolveAvatarUrl(
          payload,
          config.metadataClaim,
          config.avatarKeys,
          config.emailClaim,
        ),
      },
    };
  } catch (err) {
    return { ok: false, reason: classify(err) };
  }
}
