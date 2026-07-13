// The display-name onboarding flow, modeled as a small pure state machine so the transitions are
// testable without rendering React (the web suite runs under node, no jsdom). The React dialog
// (DisplayNameOnboarding.tsx) holds one of these states and calls the step functions; the async
// PATCH /me and its backoff live in the component, the transitions live here as a table the test
// walks. This mirrors otpModalMachine.ts exactly in style.
//
// Success is not a state here: on a confirmed write the app's chrome re-renders with the new name
// (the adapter fires onChange) and the dialog closes because the profile is no longer nameless.
// So "done" is the app's named state, not a state in this model.
import type { SetDisplayNameReason } from "../identity";

/**
 * The onboarding states. `entry` collects and edits the name, carrying the last failure's reason
 * (or null) for the inline error; `saving` waits on PATCH /me (the submit is in flight, possibly
 * mid auto-retry). A failure returns to `entry` with the reason set, never a dead end (R4): the
 * prefill is always valid, so the user is one tap from done.
 */
export type OnboardingState =
  | { readonly step: "entry"; readonly error: SetDisplayNameReason | null }
  | { readonly step: "saving" };

/** The initial state: the field seeded with the prefill suggestion, no error yet. */
export const initialOnboardingState: OnboardingState = {
  step: "entry",
  error: null,
};

/**
 * Calm, one-sentence copy per failure reason (CLAUDE.md style, GuestSignIn / emailOtpReasonOf
 * tone: American English, no error code, no em dash). Section 14.2. The three NAME_* point at a
 * fix; `rate_limited` (R9) asks for patience; `network` invites a retry; `unknown` stays generic.
 */
export const DISPLAY_NAME_REASON_COPY: Record<SetDisplayNameReason, string> = {
  NAME_REQUIRED: "Add a name so people know who you are.",
  NAME_TOO_LONG: "That name is too long. Keep it to 40 characters.",
  NAME_INVALID:
    "That name has characters we can't use. Try letters, numbers, or emoji.",
  rate_limited: "Too many changes just now. Wait a moment, then try again.",
  network: "That didn't go through. Check your connection and try again.",
  unknown: "Couldn't save your name. Try again.",
};

/** The message for a reason, always a full sentence the UI can show as-is (section 14.2). */
export function displayNameErrorOf(reason: SetDisplayNameReason): string {
  return DISPLAY_NAME_REASON_COPY[reason];
}

/** The static onboarding copy (section 14.2), co-located so the component reads one source. */
export const ONBOARDING_COPY = {
  title: "What should we call you?",
  description: "This is how you show up in a room. You can change it later.",
  placeholder: "Your name",
  submit: "Continue",
} as const;

// The transitions. Each returns the next state; the React component runs the async port call
// between them (entry -> saving on submit, saving -> entry with error on a bounded-out failure).

/** entry -> saving: the submit fired with a complete (canonicalizable, in-bounds) draft. */
export function toSaving(): OnboardingState {
  return { step: "saving" };
}

/** saving -> entry: the write failed after its bounded auto-retries; carry the reason so the
 *  field shows the inline error and the user can revert to the always-valid prefill or retry. */
export function saveFailed(reason: SetDisplayNameReason): OnboardingState {
  return { step: "entry", error: reason };
}

/** saving -> entry, cleared: a fresh attempt (the user edited and re-submitted) starts clean. */
export function clearError(): OnboardingState {
  return { step: "entry", error: null };
}
