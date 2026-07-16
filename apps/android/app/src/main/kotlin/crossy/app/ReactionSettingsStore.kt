// The receive-haptics preference (Wave 7.5; the Android twin of iOS ReactionSettings): a stored
// default, ON, that decides whether an inbound sticker landing near the active word taps softly. iOS
// keeps it a UserDefaults-backed value with a default-true fallback and no shipping Settings UI (the
// comment there points at a ReactionLab that does not ship), so Android matches: a persisted default
// read on room entry, no Settings row.
//
// Persistence is a platform concern, so the store lives here in :app over plain SharedPreferences
// behind the same small backend port NavigationSettingsStore uses (AAD-2): production wraps
// SharedPreferences, tests inject an in-memory map, so the round trip and the default resolution are
// verifiable pure on the JVM. The default reads an unset key as ON, exactly as iOS's fallback does.

package crossy.app

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext

/** The persistence seam (AAD-2), shared shape with NavigationPrefsBackend so the store is exercised
 *  against an in-memory fake with no Android framework. */
interface ReactionPrefsBackend {
    fun getBoolean(key: String, default: Boolean): Boolean
    fun putBoolean(key: String, value: Boolean)
}

/** The production backend: plain SharedPreferences, applied asynchronously (nothing here gates a frame). */
class SharedPrefsReactionBackend(private val prefs: SharedPreferences) : ReactionPrefsBackend {
    override fun getBoolean(key: String, default: Boolean): Boolean = prefs.getBoolean(key, default)
    override fun putBoolean(key: String, value: Boolean) {
        prefs.edit().putBoolean(key, value).apply()
    }
}

class ReactionSettingsStore(private val backend: ReactionPrefsBackend) {
    /** On (the default, and iOS's default-true fallback): a received sticker near the active word taps
     *  softly. Off: the room stays silent on receive. Read on room entry and threaded into the room. */
    var receiveHapticsEnabled by mutableStateOf(backend.getBoolean(KEY_RECEIVE_HAPTICS, true))
        private set

    fun updateReceiveHapticsEnabled(value: Boolean) {
        receiveHapticsEnabled = value
        backend.putBoolean(KEY_RECEIVE_HAPTICS, value)
    }

    companion object {
        /** Namespaced beside the navigation keys so a future prefs surface never collides (the same key
         *  string iOS uses, so the two platforms read one contract). */
        const val KEY_RECEIVE_HAPTICS = "crossy.reactions.receiveHaptics"

        /** The SharedPreferences file the production backend reads (shared with the other device prefs). */
        const val PREFS_NAME = "crossy.navigation.settings"
    }
}

/** The composition-root helper: one store over the app's shared prefs file, remembered per host. */
@Composable
fun rememberReactionSettingsStore(): ReactionSettingsStore {
    val context: Context = LocalContext.current
    return remember {
        ReactionSettingsStore(
            SharedPrefsReactionBackend(
                context.getSharedPreferences(ReactionSettingsStore.PREFS_NAME, Context.MODE_PRIVATE),
            ),
        )
    }
}
