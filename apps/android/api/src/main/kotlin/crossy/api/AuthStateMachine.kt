// The auth lifecycle as a pure type. Twin of apps/ios AuthStateMachine.swift. Five phases:
// signed out, authenticating, signed in, refreshing, failed. Transitions are a total function
// over (phase, event) with illegal events ignored, so a stray callback (a late refresh
// completion after sign-out) can never corrupt the phase. AuthSession drives this machine and
// owns the effects (network, store); the machine holds no tokens and touches no IO, so every
// path pins headlessly.

package crossy.api

/** Where the auth lifecycle stands. `FAILED` is the retry state; cancellation never lands here
 *  (dismissing a sign-in is a choice, not a failure). Twin of `AuthPhase`. */
public enum class AuthPhase {
    SIGNED_OUT,
    AUTHENTICATING,
    SIGNED_IN,
    REFRESHING,
    FAILED,
}

/**
 * Everything that can happen to the auth lifecycle. The two refresh failures are distinct events
 * because their consequences differ (PROTOCOL.md §12 UNAUTHORIZED posture): a refused refresh
 * token is dead, so the session honestly ends; network weather judges nothing, so the session
 * stands and the next request retries. Twin of `AuthEvent`.
 */
public enum class AuthEvent {
    SIGN_IN_STARTED,
    SIGN_IN_CANCELED,
    SIGN_IN_FAILED,
    SIGN_IN_COMPLETED,

    /** A stored session came back at launch; no sign-in leg ran. */
    SESSION_RESTORED,
    REFRESH_STARTED,
    REFRESH_SUCCEEDED,

    /** Network weather during refresh: the session stands on its stored tokens. */
    REFRESH_FAILED_TRANSIENT,

    /** The auth server refused the refresh token: the session is over. */
    REFRESH_FAILED_TERMINAL,
    SIGNED_OUT,
}

/**
 * The pure machine. [apply] mutates the phase for a legal event and reports whether the event was
 * legal; an illegal event leaves the phase untouched (and the caller drops the effect it was about
 * to run). Twin of `AuthStateMachine`.
 */
public class AuthStateMachine {
    public var phase: AuthPhase = AuthPhase.SIGNED_OUT
        private set

    /** Apply one event. Returns false (phase unchanged) when the event is illegal in the current
     *  phase. `SIGNED_OUT` is legal everywhere: sign-out is always honest. */
    public fun apply(event: AuthEvent): Boolean {
        if (event == AuthEvent.SIGNED_OUT) {
            phase = AuthPhase.SIGNED_OUT
            return true
        }
        val next = when (phase to event) {
            AuthPhase.SIGNED_OUT to AuthEvent.SIGN_IN_STARTED,
            AuthPhase.FAILED to AuthEvent.SIGN_IN_STARTED,
            -> AuthPhase.AUTHENTICATING

            AuthPhase.SIGNED_OUT to AuthEvent.SESSION_RESTORED -> AuthPhase.SIGNED_IN
            AuthPhase.AUTHENTICATING to AuthEvent.SIGN_IN_COMPLETED -> AuthPhase.SIGNED_IN
            AuthPhase.AUTHENTICATING to AuthEvent.SIGN_IN_CANCELED -> AuthPhase.SIGNED_OUT
            AuthPhase.AUTHENTICATING to AuthEvent.SIGN_IN_FAILED -> AuthPhase.FAILED
            AuthPhase.SIGNED_IN to AuthEvent.REFRESH_STARTED -> AuthPhase.REFRESHING

            AuthPhase.REFRESHING to AuthEvent.REFRESH_SUCCEEDED,
            AuthPhase.REFRESHING to AuthEvent.REFRESH_FAILED_TRANSIENT,
            -> AuthPhase.SIGNED_IN

            AuthPhase.REFRESHING to AuthEvent.REFRESH_FAILED_TERMINAL -> AuthPhase.SIGNED_OUT
            else -> return false
        }
        phase = next
        return true
    }
}
