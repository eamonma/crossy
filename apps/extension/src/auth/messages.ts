// The popup-to-service-worker auth contract. The worker owns every token movement
// (sign-in exchange, refresh, revocation) so refreshes serialize in one place and
// rotation never races between contexts; the popup only renders stored state and
// asks for a fresh access token when it ingests.

import type { Provider } from "./flow";

export const AUTH_SIGN_IN = "crossy/auth/sign-in" as const;
export const AUTH_SILENT_SIGN_IN = "crossy/auth/silent-sign-in" as const;
export const AUTH_WEB_SIGNAL = "crossy/auth/web-signal" as const;
export const AUTH_SIGN_OUT = "crossy/auth/sign-out" as const;
export const AUTH_TOKEN = "crossy/auth/token" as const;

/**
 * The account identity of the crossy.party web session, read by the content script
 * from the web app's stored session. NEVER a token: only the Supabase user id (the
 * alignment key), the OAuth provider (to steer the extension's sign-in to the same
 * account), and a display name (to name the account in the popup). Present only for a
 * live web session signed in with a provider the extension can also use.
 */
export interface WebIdentity {
  readonly userId: string;
  readonly provider: Provider;
  readonly displayName: string;
}

/**
 * The content script's report of the web app's account, sent on every crossy.party
 * load: an identity when the web app is signed in with a steerable provider, or null
 * when it is signed out (or an unsteerable guest). The worker stashes it, so the popup
 * can offer "continue as <name>" or warn on a mismatch, and steers a silent attempt at
 * the same provider when the extension is signed out.
 */
export interface WebSignalRequest {
  readonly type: typeof AUTH_WEB_SIGNAL;
  readonly identity: WebIdentity | null;
}

export interface SignInRequest {
  readonly type: typeof AUTH_SIGN_IN;
  readonly provider: Provider;
}

export type SignInReply =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Ask the worker to sign in without any UI, riding a live provider session in the
 * browser (interactive:false). Sent by the popup when it opens signed out. No provider
 * field: the worker steers the attempt at the last-known web account's provider (the
 * web signal), falling back to the primary provider (Discord) when none is stashed.
 */
export interface SilentSignInRequest {
  readonly type: typeof AUTH_SILENT_SIGN_IN;
}

/**
 * The silent attempt only ever succeeds or quietly fails. "failed" is not an error to
 * surface: the extension was signed out before the attempt and stays signed out, with
 * nothing lost. There is no reason string because there is nothing to show.
 */
export type SilentSignInReply = { readonly ok: true } | { readonly ok: false };

export interface SignOutRequest {
  readonly type: typeof AUTH_SIGN_OUT;
}

export interface TokenRequest {
  readonly type: typeof AUTH_TOKEN;
}

/**
 * "signed_out" means the session is gone (never signed in, or a definitive refresh
 * failure cleared it); "network" means the refresh could not run and the caller
 * should try again without losing the session.
 */
export type TokenReply =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly reason: "signed_out" | "network" };
