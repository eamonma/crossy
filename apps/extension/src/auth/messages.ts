// The popup-to-service-worker auth contract. The worker owns every token movement
// (sign-in exchange, refresh, revocation) so refreshes serialize in one place and
// rotation never races between contexts; the popup only renders stored state and
// asks for a fresh access token when it ingests.

import type { Provider } from "./flow";

export const AUTH_SIGN_IN = "crossy/auth/sign-in" as const;
export const AUTH_SILENT_SIGN_IN = "crossy/auth/silent-sign-in" as const;
export const AUTH_SIGN_OUT = "crossy/auth/sign-out" as const;
export const AUTH_TOKEN = "crossy/auth/token" as const;

export interface SignInRequest {
  readonly type: typeof AUTH_SIGN_IN;
  readonly provider: Provider;
}

export type SignInReply =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Ask the worker to sign in without any UI, riding a live provider session in the
 * browser (interactive:false). Sent by the popup when it opens signed out and by the
 * crossy.party content script when the web app is signed in. No provider field: the
 * silent path tries the primary provider (Discord) only.
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
