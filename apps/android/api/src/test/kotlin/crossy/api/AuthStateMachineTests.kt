// The pure auth lifecycle (the five phases). Twin of apps/ios AuthStateMachineTests.swift. Every
// transition and every ignored illegal event pins headlessly: AuthSession owns effects, this
// machine owns truth, so a stray callback can never corrupt the phase.

package crossy.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AuthStateMachineTests {
    private fun machine(vararg events: AuthEvent): AuthStateMachine {
        val m = AuthStateMachine()
        for (event in events) m.apply(event)
        return m
    }

    @Test
    fun theHappyPathWalksSignedOutToSignedIn() {
        val m = AuthStateMachine()
        assertEquals(AuthPhase.SIGNED_OUT, m.phase)
        assertTrue(m.apply(AuthEvent.SIGN_IN_STARTED))
        assertEquals(AuthPhase.AUTHENTICATING, m.phase)
        assertTrue(m.apply(AuthEvent.SIGN_IN_COMPLETED))
        assertEquals(AuthPhase.SIGNED_IN, m.phase)
    }

    @Test
    fun aFailedSignInLandsInFailedAndRetryReenters() {
        // Auth failure returns to Welcome with a plain retry, never a dead end: FAILED accepts
        // SIGN_IN_STARTED again.
        val m = machine(AuthEvent.SIGN_IN_STARTED, AuthEvent.SIGN_IN_FAILED)
        assertEquals(AuthPhase.FAILED, m.phase)
        assertTrue(m.apply(AuthEvent.SIGN_IN_STARTED))
        assertEquals(AuthPhase.AUTHENTICATING, m.phase)
    }

    @Test
    fun cancelingReturnsQuietlyToSignedOutNotFailed() {
        // Dismissing a sign-in is a choice, not a failure: no retry copy, no error.
        val m = machine(AuthEvent.SIGN_IN_STARTED, AuthEvent.SIGN_IN_CANCELED)
        assertEquals(AuthPhase.SIGNED_OUT, m.phase)
    }

    @Test
    fun aStoreRestoreSignsInWithoutTheSignInLeg() {
        val m = machine(AuthEvent.SESSION_RESTORED)
        assertEquals(AuthPhase.SIGNED_IN, m.phase)
    }

    @Test
    fun refreshWalksSignedInThroughRefreshingAndBack() {
        val m = machine(AuthEvent.SESSION_RESTORED, AuthEvent.REFRESH_STARTED)
        assertEquals(AuthPhase.REFRESHING, m.phase)
        assertTrue(m.apply(AuthEvent.REFRESH_SUCCEEDED))
        assertEquals(AuthPhase.SIGNED_IN, m.phase)
    }

    @Test
    fun aTransientRefreshFailureKeepsTheSessionStanding_INV11() {
        // Network weather judges nothing: the session stands on stored tokens and the next request
        // retries (the UNAUTHORIZED verdict is the API's to give). The INV-11 posture at the
        // machine level: a transient failure is never a dead stop.
        val m = machine(
            AuthEvent.SESSION_RESTORED,
            AuthEvent.REFRESH_STARTED,
            AuthEvent.REFRESH_FAILED_TRANSIENT,
        )
        assertEquals(AuthPhase.SIGNED_IN, m.phase)
    }

    @Test
    fun aTerminalRefreshRefusalEndsTheSessionHonestly() {
        // A refused refresh token is dead; the honest outcome is signed out, never a limbo that
        // keeps dialing with a corpse.
        val m = machine(
            AuthEvent.SESSION_RESTORED,
            AuthEvent.REFRESH_STARTED,
            AuthEvent.REFRESH_FAILED_TERMINAL,
        )
        assertEquals(AuthPhase.SIGNED_OUT, m.phase)
    }

    @Test
    fun signOutIsLegalFromEveryPhase() {
        val walks = listOf(
            emptyList(),
            listOf(AuthEvent.SIGN_IN_STARTED),
            listOf(AuthEvent.SIGN_IN_STARTED, AuthEvent.SIGN_IN_COMPLETED),
            listOf(AuthEvent.SIGN_IN_STARTED, AuthEvent.SIGN_IN_FAILED),
            listOf(AuthEvent.SESSION_RESTORED, AuthEvent.REFRESH_STARTED),
        )
        for (events in walks) {
            val m = machine(*events.toTypedArray())
            assertTrue(m.apply(AuthEvent.SIGNED_OUT), "SIGNED_OUT must be legal after $events")
            assertEquals(AuthPhase.SIGNED_OUT, m.phase)
        }
    }

    @Test
    fun illegalEventsAreIgnoredAndReportFalse() {
        // A stray completion while signed out (a late callback after sign-out) must not resurrect
        // a session.
        val m = AuthStateMachine()
        assertFalse(m.apply(AuthEvent.SIGN_IN_COMPLETED))
        assertEquals(AuthPhase.SIGNED_OUT, m.phase)
        assertFalse(m.apply(AuthEvent.REFRESH_SUCCEEDED))
        assertEquals(AuthPhase.SIGNED_OUT, m.phase)

        val signedIn = machine(AuthEvent.SESSION_RESTORED)
        assertFalse(signedIn.apply(AuthEvent.SIGN_IN_COMPLETED))
        assertEquals(AuthPhase.SIGNED_IN, signedIn.phase)
        assertFalse(signedIn.apply(AuthEvent.SESSION_RESTORED), "a second restore is a no-op")
        assertEquals(AuthPhase.SIGNED_IN, signedIn.phase)
    }
}
