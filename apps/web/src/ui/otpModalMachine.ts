// The "Continue another way" email flow, modeled as a small pure state machine so the transitions
// are testable without rendering React (the web suite runs under node, no jsdom). The React modal
// (ContinueAnotherWay.tsx) holds one of these states and calls the two step functions; success is
// never in this model, because a verified session lands through the app's identity onChange, not
// through a verify return (types.ts). The modal closes on that onChange, so "success" is the app's
// authenticated state, not a state here.
import type { EmailOtpReason } from "../identity";

/**
 * The email path's states. `hisbaan` and the closed modal are not here: this machine owns only the
 * email sub-flow. `emailEntry` collects the address; `sending` waits on sendEmailOtp; `codeEntry`
 * collects the six-digit code (carrying the email it was sent to, for the "sent a code to {email}"
 * line and the resend); `verifying` waits on verifyEmailOtp. A failure returns to the entry it came
 * from with `error` set, never a dead end.
 */
export type OtpEmailState =
  | { readonly step: "emailEntry"; readonly error: string | null }
  | { readonly step: "sending"; readonly email: string }
  | {
      readonly step: "codeEntry";
      readonly email: string;
      readonly error: string | null;
    }
  | { readonly step: "verifying"; readonly email: string };

/** The initial email state: an empty address field, no error. */
export const initialEmailState: OtpEmailState = {
  step: "emailEntry",
  error: null,
};

/**
 * Calm, high-leverage copy per failure reason (CLAUDE.md style, GuestSignIn tone: one sentence, no
 * error code, no em dash). Shared by both the code-entry failures and the confirm route, so the two
 * surfaces speak with one voice. `rate_limited` asks for patience; `invalid_code`/`expired` point
 * at a fix (check it, or resend); `network` invites a retry; `unknown` stays generic.
 */
export const OTP_REASON_COPY: Record<EmailOtpReason, string> = {
  rate_limited: "Too many tries just now. Wait a moment, then try again.",
  invalid_code: "That code didn't match. Check it, or send a new one.",
  expired: "That code has expired. Send a new one.",
  network: "That didn't go through. Check your connection and try again.",
  unknown: "That didn't go through. Give it another try.",
};

/** The message for a reason, always a full sentence the UI can show as-is. */
export function otpReasonMessage(reason: EmailOtpReason): string {
  return OTP_REASON_COPY[reason];
}

/** A trimmed, lowercased email passes only a minimal shape check (has an @, a dot after it, no
 *  spaces). The provider is the real validator; this only stops an obviously empty submit from
 *  starting the flow. ASCII-only, no locale casing (INV-1). */
export function isPlausibleEmail(raw: string): boolean {
  const email = raw.trim();
  if (email.length === 0 || /\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at <= 0) return false;
  const dot = email.indexOf(".", at + 2);
  return dot !== -1 && dot < email.length - 1;
}

/** Keep only digits, capped at six: the code field accepts a paste or a keyboard but never holds
 *  more than a full code, so the submit button's enabled state is a simple length check. */
export function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

/** The code is submittable once it is a full six digits. */
export function isCompleteCode(code: string): boolean {
  return sanitizeCode(code).length === 6;
}

// The transitions. Each returns the next state; the React component runs the async port call
// between them (sending -> codeEntry on ok, sending -> emailEntry with error on failure, etc.).
// Keeping them as pure functions makes the whole flow a table the test walks.

/** emailEntry -> sending: the submit fired with a plausible address. */
export function toSending(email: string): OtpEmailState {
  return { step: "sending", email: email.trim() };
}

/** sending -> codeEntry: sendEmailOtp resolved ok, so show the code entry for this email. */
export function toCodeEntry(email: string): OtpEmailState {
  return { step: "codeEntry", email, error: null };
}

/** sending -> emailEntry: sendEmailOtp failed; carry the reason's copy back to the address step. */
export function sendFailed(reason: EmailOtpReason): OtpEmailState {
  return { step: "emailEntry", error: otpReasonMessage(reason) };
}

/** codeEntry -> verifying: the six-digit code was submitted for this email. */
export function toVerifying(email: string): OtpEmailState {
  return { step: "verifying", email };
}

/** verifying -> codeEntry: verifyEmailOtp failed; stay on the code with the reason's copy so the
 *  user can fix a typo or resend, never bounced back to re-enter the email. */
export function verifyFailed(
  email: string,
  reason: EmailOtpReason,
): OtpEmailState {
  return { step: "codeEntry", email, error: otpReasonMessage(reason) };
}

/** codeEntry -> emailEntry: the "use a different email" back action, cleared of any error. */
export function backToEmail(): OtpEmailState {
  return { step: "emailEntry", error: null };
}
