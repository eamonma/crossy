// The auth port (DESIGN.md §8): the anti-corruption layer that translates a vendor
// identity into an internal one. Both the API and the session service embed this port
// to key requests on `user_id`, so it is an inner-ring package that neither app imports
// from the other (DESIGN.md §4). Services depend on these types only, never on `jose`.
//
// Section 8 names three port functions: `verify`, `linkIdentity`, `deleteUser`. This
// package implements `verify` — the pure, local, zero-network, per-request check that
// both services run on the keystroke/request path (SP2). `linkIdentity` and `deleteUser`
// are vendor *mutations* (network round-trips against Supabase's admin API with the
// service_role credential) invoked only by the API's identity module, and the deletion
// tombstone is a write to the API-owned `users` table (single-writer, INV-7); neither
// belongs on the request-path verification port. See index.ts and the report for the
// boundary rationale.

/**
 * The identity a verified access token resolves to: the two claims both services key on
 * (SP2, DESIGN.md §8). `userId` is the JWT `sub` (the same UUID the provider issues and
 * our `users` table mirrors). `isAnonymous` is the `is_anonymous` claim, defaulting to
 * `false` when absent (permanent users may omit it).
 */
export interface Identity {
  readonly userId: string;
  readonly isAnonymous: boolean;
}

/**
 * The typed reasons a verification can fail, one per SP2 claim check. Callers key on
 * these instead of catching library exceptions, so the port stays decoupled from `jose`.
 * `bad-signature` also covers a refused algorithm (a non-allowlisted `alg` such as
 * HS256), which is a signature-trust refusal and the alg-confusion defense from SP2.
 */
export type AuthFailureReason =
  | "expired"
  | "bad-signature"
  | "wrong-issuer"
  | "wrong-audience"
  | "unknown-key"
  | "malformed";

export interface VerifySuccess {
  readonly ok: true;
  readonly identity: Identity;
}

export interface VerifyFailure {
  readonly ok: false;
  readonly reason: AuthFailureReason;
}

/**
 * The result of verifying an access token. A discriminated union rather than a thrown
 * error: the services `switch` on `ok`/`reason` exhaustively and never reach for `jose`.
 */
export type VerifyResult = VerifySuccess | VerifyFailure;

/**
 * The auth port both services embed. `verify` is asynchronous to match the underlying
 * WebCrypto verification, but it performs **zero network IO** on the request path: it
 * runs entirely against an in-memory key set (SP2). Two implementations satisfy this
 * interface and pass one shared contract: the JWKS adapter and the in-memory fake.
 */
export interface AuthPort {
  verify(token: string): Promise<VerifyResult>;
}

/**
 * The default expected audience. `authenticated` is the vendor's (GoTrue) convention for
 * a user access token, and every token our production issuer mints carries it. It is a
 * default, not a constant of the verifier: an issuer that names its audience otherwise
 * overrides it via config (DESIGN.md §8, SP2).
 */
export const DEFAULT_AUDIENCE = "authenticated";

/**
 * The default name of the claim carrying the anonymity flag. GoTrue (the vendor's auth
 * server) signals an anonymous session with `is_anonymous: true`. This is the one
 * GoTrue-specific claim the verifier reads, lifted to overridable config so the core
 * carries no single vendor's claim vocabulary; an issuer that names it otherwise overrides
 * it (DESIGN.md §8, SP2).
 */
export const DEFAULT_ANONYMOUS_CLAIM = "is_anonymous";

/**
 * The asymmetric algorithm allowlist (SP2). ES256 is Supabase's default; RS256 and
 * EdDSA are accepted so an operator can rotate algorithm without a code change. HS256
 * and every other symmetric algorithm are refused, closing the alg-confusion downgrade.
 */
export const DEFAULT_ALGORITHMS: readonly string[] = [
  "ES256",
  "RS256",
  "EdDSA",
];

/** Clock-skew tolerance for `exp`/`nbf`, in seconds (SP2: ~10 s). */
export const DEFAULT_CLOCK_TOLERANCE_SEC = 10;

/** Background JWKS refresh interval, in milliseconds (SP2: minutes, not seconds). */
export const DEFAULT_REFRESH_INTERVAL_MS = 300_000;

/**
 * Debounce window for the out-of-band refresh an unknown `kid` triggers, in
 * milliseconds. A burst of unknown-`kid` tokens coalesces into exactly one refresh
 * (SP2: fail closed, schedule one debounced refresh, never fetch synchronously).
 */
export const DEFAULT_UNKNOWN_KID_DEBOUNCE_MS = 10_000;
