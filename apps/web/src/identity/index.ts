// The Identity port barrel. The app imports the port and the factory from here; only files
// inside src/identity import supabase-js (dependency-cruiser enforces it).
export type {
  Identity,
  IdentitySession,
  GuestSignInOptions,
  GuestSignInResult,
  SessionChangeCause,
  SignInProvider,
} from "./types";
export { createIdentity, shouldUseSupabase } from "./createIdentity";
export { createMockIdentity } from "./mockAdapter";
