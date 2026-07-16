// Where the OAuth deep link crosses from the intent world into compose. MainActivity delivers
// each crossy://auth/callback URI here (onNewIntent on a warm return, the launch intent on a cold
// start); the sign-in host observes the latest delivery and consumes it exactly once. Intent and
// browser concerns stay in :app (AAD-2); :ui never sees a URI.

package crossy.app

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/** One delivered redirect: the callback URI plus the delivery's own id, the consume-once key that
 *  keeps two intents distinct even when they carry the same URI. */
data class OAuthRedirect(val id: Int, val uri: String)

class OAuthRedirects {
    /** The standing (unconsumed) redirect, observable compose state. */
    var latest: OAuthRedirect? by mutableStateOf(null)
        private set

    private var nextId = 0

    /** A new intent's redirect. It supersedes an unconsumed older one: AuthSession holds one
     *  pending verifier, so only the newest attempt could ever complete anyway. */
    fun deliver(uri: String) {
        latest = OAuthRedirect(nextId++, uri)
    }

    /** Spend [redirect]. Clears only when it is still the standing one, so a delivery that raced
     *  in behind it is never dropped. */
    fun consume(redirect: OAuthRedirect) {
        if (latest?.id == redirect.id) latest = null
    }
}
