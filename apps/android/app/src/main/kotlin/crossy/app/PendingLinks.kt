// Where the non-auth deep links cross from the intent world into compose, the twin of
// OAuthRedirects (which owns the crossy://auth/callback OAuth lane). MainActivity's router delivers
// each recognized link here (onNewIntent on a warm return, the launch intent on a cold start); the
// signed-in shell observes each slot and honors it exactly once. Intent and URI concerns stay in
// :app (AAD-2); :ui never sees a URI.
//
// Three slots, distinct because they are honored at different times and by different flows (the iOS
// PendingInvite / PendingMagicLink / PendingPlay split): an invite waits for signed-in + arrival
// then opens the join flow prefilled, a magic link completes against the session and lands sign-in,
// a play link hands a puzzle to the Puzzles tab. Each carries its own consume-once id, the same
// discipline OAuthRedirects uses to keep two intents distinct even when they carry the same link.

package crossy.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** A held invite code (crossy://game/<id>?code=, or any recognized invite shape). */
data class PendingInvite(val id: Int, val code: String)

/** A held magic link, ready for completeMagicLink (roadmap I3b). */
data class PendingMagicLink(val id: Int, val tokenHash: String, val type: String)

/** A held play hand-off (crossy://play/<puzzleId>), for the Puzzles tab to open. */
data class PendingPlay(val id: Int, val puzzleId: String)

class PendingLinks {
    /** The standing (unconsumed) invite, observable compose state. */
    var invite: PendingInvite? by mutableStateOf(null)
        private set

    /** The standing (unconsumed) magic link, observable compose state. */
    var magicLink: PendingMagicLink? by mutableStateOf(null)
        private set

    /** The standing (unconsumed) play hand-off, observable compose state. */
    var play: PendingPlay? by mutableStateOf(null)
        private set

    private var nextId = 0

    /** A new invite. It supersedes an unconsumed older one: only the newest deep link matters. */
    fun deliverInvite(code: String) {
        invite = PendingInvite(nextId++, code)
    }

    /** A new magic link. Supersedes an unconsumed older one: only the newest link could complete. */
    fun deliverMagicLink(tokenHash: String, type: String) {
        magicLink = PendingMagicLink(nextId++, tokenHash, type)
    }

    /** A new play hand-off. Supersedes an unconsumed older one. */
    fun deliverPlay(puzzleId: String) {
        play = PendingPlay(nextId++, puzzleId)
    }

    /** Spend [pending]. Clears only when it is still the standing one, so a delivery that raced in
     *  behind it is never dropped (the OAuthRedirects consume discipline). */
    fun consumeInvite(pending: PendingInvite) {
        if (invite?.id == pending.id) invite = null
    }

    fun consumeMagicLink(pending: PendingMagicLink) {
        if (magicLink?.id == pending.id) magicLink = null
    }

    fun consumePlay(pending: PendingPlay) {
        if (play?.id == pending.id) play = null
    }
}
