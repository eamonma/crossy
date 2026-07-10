import XCTest

import CrossyAPI

// The pure auth lifecycle (roadmap I3a; the five phases EXPERIENCE.md §2-3 walk).
// Every transition and every ignored illegal event pins headlessly: AuthSession owns
// effects, this machine owns truth, so a stray callback can never corrupt the phase.

final class AuthStateMachineTests: XCTestCase {
    private func machine(after events: [AuthEvent]) -> AuthStateMachine {
        var m = AuthStateMachine()
        for event in events { m.apply(event) }
        return m
    }

    func test_theHappyPathWalksSignedOutToSignedIn() {
        var m = AuthStateMachine()
        XCTAssertEqual(m.phase, .signedOut)
        XCTAssertTrue(m.apply(.signInStarted))
        XCTAssertEqual(m.phase, .authenticating)
        XCTAssertTrue(m.apply(.signInCompleted))
        XCTAssertEqual(m.phase, .signedIn)
    }

    func test_aFailedSignInLandsInFailedAndRetryReenters_EXPERIENCEWelcomeRetry() {
        // EXPERIENCE.md §3 Welcome: auth failure returns here with a plain retry,
        // never a dead end. failed accepts signInStarted again.
        var m = machine(after: [.signInStarted, .signInFailed])
        XCTAssertEqual(m.phase, .failed)
        XCTAssertTrue(m.apply(.signInStarted))
        XCTAssertEqual(m.phase, .authenticating)
    }

    func test_cancelingTheSheetReturnsQuietlyToSignedOutNotFailed() {
        // Dismissing the sheet is a choice, not a failure: no retry copy, no error.
        let m = machine(after: [.signInStarted, .signInCanceled])
        XCTAssertEqual(m.phase, .signedOut)
    }

    func test_aKeychainRestoreSignsInWithoutTheWebLeg() {
        let m = machine(after: [.sessionRestored])
        XCTAssertEqual(m.phase, .signedIn)
    }

    func test_refreshWalksSignedInThroughRefreshingAndBack() {
        var m = machine(after: [.sessionRestored, .refreshStarted])
        XCTAssertEqual(m.phase, .refreshing)
        XCTAssertTrue(m.apply(.refreshSucceeded))
        XCTAssertEqual(m.phase, .signedIn)
    }

    func test_aTransientRefreshFailureKeepsTheSessionStanding() {
        // Network weather judges nothing: the session stands on stored tokens and
        // the next request retries (the UNAUTHORIZED verdict is the API's to give).
        let m = machine(after: [.sessionRestored, .refreshStarted, .refreshFailedTransient])
        XCTAssertEqual(m.phase, .signedIn)
    }

    func test_aTerminalRefreshRefusalEndsTheSessionHonestly() {
        // A refused refresh token is dead; the honest outcome is signed out, never a
        // limbo that keeps dialing with a corpse.
        let m = machine(after: [.sessionRestored, .refreshStarted, .refreshFailedTerminal])
        XCTAssertEqual(m.phase, .signedOut)
    }

    func test_signOutIsLegalFromEveryPhase() {
        let phases: [[AuthEvent]] = [
            [],
            [.signInStarted],
            [.signInStarted, .signInCompleted],
            [.signInStarted, .signInFailed],
            [.sessionRestored, .refreshStarted],
        ]
        for events in phases {
            var m = machine(after: events)
            XCTAssertTrue(m.apply(.signedOut), "signedOut must be legal after \(events)")
            XCTAssertEqual(m.phase, .signedOut)
        }
    }

    func test_illegalEventsAreIgnoredAndReportFalse() {
        // A stray completion while signed out (a late callback after sign-out) must
        // not resurrect a session.
        var m = AuthStateMachine()
        XCTAssertFalse(m.apply(.signInCompleted))
        XCTAssertEqual(m.phase, .signedOut)
        XCTAssertFalse(m.apply(.refreshSucceeded))
        XCTAssertEqual(m.phase, .signedOut)

        var signedIn = machine(after: [.sessionRestored])
        XCTAssertFalse(signedIn.apply(.signInCompleted))
        XCTAssertEqual(signedIn.phase, .signedIn)
        XCTAssertFalse(signedIn.apply(.sessionRestored), "a second restore is a no-op")
        XCTAssertEqual(signedIn.phase, .signedIn)
    }
}
