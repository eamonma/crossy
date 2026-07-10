// The auth lifecycle as a pure type (roadmap I3a). Five phases: signed out,
// authenticating, signed in, refreshing, failed. Transitions are a total function
// over (phase, event) with illegal events ignored, so a stray callback (a second
// sheet dismissal, a refresh completion after sign-out) can never corrupt the phase.
// AuthSession drives this machine and owns the effects (web sheet, Keychain, network);
// the machine holds no tokens and touches no IO, so every path pins headlessly.
//
// The shape follows EXPERIENCE.md §3: auth failure returns to Welcome with a plain
// retry (failed accepts signInStarted), and a user closing the sheet is a quiet
// return to signed out, not an error to apologize for.

/// Where the auth lifecycle stands. `failed` is the Welcome screen's retry state;
/// cancellation never lands here (dismissing the sheet is a choice, not a failure).
public enum AuthPhase: Equatable, Sendable {
    case signedOut
    case authenticating
    case signedIn
    case refreshing
    case failed
}

/// Everything that can happen to the auth lifecycle. The two refresh failures are
/// distinct events because their consequences differ (PROTOCOL.md §12 UNAUTHORIZED
/// posture): a refused refresh token is dead, so the session honestly ends; network
/// weather judges nothing, so the session stands and the next request retries.
public enum AuthEvent: Equatable, Sendable {
    case signInStarted
    case signInCanceled
    case signInFailed
    case signInCompleted
    /// A stored Keychain session came back at launch; no web leg ran.
    case sessionRestored
    case refreshStarted
    case refreshSucceeded
    /// Network weather during refresh: the session stands on its stored tokens.
    case refreshFailedTransient
    /// The auth server refused the refresh token: the session is over.
    case refreshFailedTerminal
    case signedOut
}

/// The pure machine. `apply` mutates the phase for a legal event and reports whether
/// the event was legal; an illegal event leaves the phase untouched (and the caller
/// can drop the effect it was about to run).
public struct AuthStateMachine: Equatable, Sendable {
    public private(set) var phase: AuthPhase = .signedOut

    public init() {}

    /// Apply one event. Returns false (phase unchanged) when the event is illegal in
    /// the current phase. `signedOut` is legal everywhere: sign-out is always honest.
    @discardableResult
    public mutating func apply(_ event: AuthEvent) -> Bool {
        if event == .signedOut {
            phase = .signedOut
            return true
        }
        switch (phase, event) {
        case (.signedOut, .signInStarted), (.failed, .signInStarted):
            phase = .authenticating
        case (.signedOut, .sessionRestored):
            phase = .signedIn
        case (.authenticating, .signInCompleted):
            phase = .signedIn
        case (.authenticating, .signInCanceled):
            phase = .signedOut
        case (.authenticating, .signInFailed):
            phase = .failed
        case (.signedIn, .refreshStarted):
            phase = .refreshing
        case (.refreshing, .refreshSucceeded), (.refreshing, .refreshFailedTransient):
            phase = .signedIn
        case (.refreshing, .refreshFailedTerminal):
            phase = .signedOut
        default:
            return false
        }
        return true
    }
}
