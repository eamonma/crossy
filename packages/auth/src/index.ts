// The auth port package (DESIGN.md §8, SP2). The API and session service embed this to
// turn a provider-issued access token (Supabase's GoTrue in production) into an internal
// identity (`userId`, `isAnonymous`), verified locally with zero per-request network IO.
// Services depend on the `AuthPort` type and pick an implementation; they never import
// `jose` directly.
//
// Scope boundary (see the report). Section 8 lists three port functions —
// `verify`, `linkIdentity`, `deleteUser` — but they are not one operational surface.
// This package ships `verify`: the pure, local, per-request check both services run.
//   - `linkIdentity` is, per SP1, a client-driven OAuth flow; the server observes only
//     the refreshed token, which `verify` already handles. There is no server-side link
//     admin call in the happy path.
//   - `deleteUser` splits in two: removing the *vendor* identity is a Supabase admin
//     (service_role) network call owned by the API's identity module, and tombstoning
//     the mirror row is a write to the API-owned `users` table (single-writer, INV-7).
//     Neither is the request-path verification port, so neither ships here.
// Both live with the API, not in this inner-ring package that both services embed.

export type {
  AuthPort,
  Identity,
  VerifyResult,
  VerifySuccess,
  VerifyFailure,
  AuthFailureReason,
} from "./port";
export {
  DEFAULT_AUDIENCE,
  DEFAULT_ANONYMOUS_CLAIM,
  DEFAULT_METADATA_CLAIM,
  DEFAULT_NAME_KEYS,
  DEFAULT_AVATAR_KEYS,
  DEFAULT_EMAIL_CLAIM,
  GRAVATAR_BASE_URL,
  DEFAULT_ALGORITHMS,
  DEFAULT_CLOCK_TOLERANCE_SEC,
  DEFAULT_REFRESH_INTERVAL_MS,
  DEFAULT_UNKNOWN_KID_DEBOUNCE_MS,
} from "./port";

import { createJwksAuthPort } from "./jwks";
import type { JwksAuthConfig, JwksAuthPort } from "./jwks";

export type {
  JwksAuthConfig,
  JwksAuthPort,
  Scheduler,
  TimerHandle,
} from "./jwks";
export { createJwksAuthPort, deriveJwksUri } from "./jwks";

// Deprecated pre-rename aliases. The server adapter is a generic JWKS verifier with
// nothing Supabase-specific, so it was renamed jwks.*; these keep any straggler import of
// the old names compiling. Remove in a future sweep once no such imports remain.
export const createSupabaseAuthPort = createJwksAuthPort;
export type SupabaseAuthConfig = JwksAuthConfig;
export type SupabaseAuthPort = JwksAuthPort;

export type { FakeAuthConfig, FakeAuthProvider, MintOptions } from "./fake";
export { createFakeAuthProvider } from "./fake";
