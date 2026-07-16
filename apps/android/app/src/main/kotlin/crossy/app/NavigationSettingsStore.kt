// The per-device typing preferences, persisted in SharedPreferences (personal-settings slice 1),
// the Android twin of iOS NavigationSettingsStore. Client-local and off the wire entirely: these
// knobs shape only where this device's cursor lands after a keystroke, so they never touch the
// shared board (INV-6 is unaffected; nothing here is a game mutation).
//
// Persistence is a platform concern, so the store lives here in :app over plain SharedPreferences
// (not secret material, so no Keystore) behind a small backend port (AAD-2): production wraps
// SharedPreferences, tests inject an in-memory map, so the round trip and the default resolution are
// verifiable pure on the JVM. The store maps its two booleans to BoardNavigation's plain prefs, never
// to a CrossyEngine type. The defaults reproduce the pre-slice behavior exactly (skip filled cells,
// wrap to the word's first blank), so a person who never opens Settings sees no change and the
// navigation vectors stay green.
//
// Android's shell is single-screen (one `when(screen)`), so Settings and an open room never compose
// at once; each host reads the persisted store on entry, so a change made in Settings is honored the
// next time the room composes. The Compose state makes a live in-place read correct too, for a future
// shell where the two coexist.

package crossy.app

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import crossy.store.BoardNavigation

/** The persistence seam (AAD-2): the store reads and writes two booleans through this, so its logic
 *  is exercised against an in-memory fake with no Android framework. */
interface NavigationPrefsBackend {
    fun getBoolean(key: String, default: Boolean): Boolean
    fun putBoolean(key: String, value: Boolean)
}

/** The production backend: plain SharedPreferences, applied asynchronously (nothing here gates a
 *  frame). */
class SharedPrefsNavigationBackend(private val prefs: SharedPreferences) : NavigationPrefsBackend {
    override fun getBoolean(key: String, default: Boolean): Boolean = prefs.getBoolean(key, default)
    override fun putBoolean(key: String, value: Boolean) {
        prefs.edit().putBoolean(key, value).apply()
    }
}

class NavigationSettingsStore(private val backend: NavigationPrefsBackend) {
    /** On (the NYT default, and the pre-slice behavior): typing advances past already-filled cells to
     *  the next blank inside the word. Off: advance to the immediately next cell regardless of fill. */
    var skipFilledInWord by mutableStateOf(backend.getBoolean(KEY_SKIP_FILLED, true))
        private set

    /** True selects "move to the next clue" the moment the word fills; false (the pre-slice default)
     *  keeps the wrap-to-first-blank behavior. Stored as the boolean the picker toggles, mapped to
     *  `EndOfWord` at the boundary. */
    var endOfWordIsNextClue by mutableStateOf(backend.getBoolean(KEY_END_OF_WORD_NEXT_CLUE, false))
        private set

    fun updateSkipFilledInWord(value: Boolean) {
        skipFilledInWord = value
        backend.putBoolean(KEY_SKIP_FILLED, value)
    }

    fun updateEndOfWordIsNextClue(value: Boolean) {
        endOfWordIsNextClue = value
        backend.putBoolean(KEY_END_OF_WORD_NEXT_CLUE, value)
    }

    /** The store's prefs re-expressed for the navigation layer (BoardNavigation owns the plain type;
     *  AD-2 keeps the engine's out of these upper layers). `DEFAULT` is reproduced bit for bit when
     *  neither knob has been touched, so an unset device diverges from no navigation vector. */
    val navigationPrefs: BoardNavigation.NavigationPrefs
        get() = BoardNavigation.NavigationPrefs(
            skipFilledInWord = skipFilledInWord,
            endOfWord = if (endOfWordIsNextClue) {
                BoardNavigation.EndOfWord.NEXT_CLUE
            } else {
                BoardNavigation.EndOfWord.FIRST_BLANK
            },
        )

    companion object {
        /** Namespaced so a future prefs surface never collides. */
        const val KEY_SKIP_FILLED = "nav.skipFilledInWord"
        const val KEY_END_OF_WORD_NEXT_CLUE = "nav.endOfWordIsNextClue"

        /** The SharedPreferences file the production backend reads. */
        const val PREFS_NAME = "crossy.navigation.settings"
    }
}

/** The composition-root helper: one store over the app's shared prefs file, so Settings edits and
 *  the room's entry read land in the same place (the single source across screens). Remembered per
 *  host so each composition holds one instance; the file makes them agree. */
@Composable
fun rememberNavigationSettingsStore(): NavigationSettingsStore {
    val context: Context = LocalContext.current
    return remember {
        NavigationSettingsStore(
            SharedPrefsNavigationBackend(
                context.getSharedPreferences(NavigationSettingsStore.PREFS_NAME, Context.MODE_PRIVATE),
            ),
        )
    }
}
