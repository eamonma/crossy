// The per-device typing prefs store's round trip (personal-settings slice 1), run pure on the JVM
// (testProdDebugUnitTest): the persistence is behind the NavigationPrefsBackend port, so an in-memory
// fake stands in for SharedPreferences and no device is involved. What this pins: the defaults
// reproduce the pre-slice behavior exactly (so an unset device diverges from no navigation vector),
// the setters persist, a fresh store reads what a prior one wrote, and the mapping to
// BoardNavigation's plain prefs is faithful. Twin of the iOS NavigationSettingsStore's contract.

package crossy.app

import crossy.api.AuthProvider
import crossy.store.BoardNavigation
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NavigationSettingsStoreTests {
    private class FakeBackend(val map: MutableMap<String, Boolean> = mutableMapOf()) :
        NavigationPrefsBackend {
        override fun getBoolean(key: String, default: Boolean): Boolean = map[key] ?: default
        override fun putBoolean(key: String, value: Boolean) {
            map[key] = value
        }
    }

    @Test
    fun defaults_reproducePreSliceBehavior_soNoNavigationVectorDiverges() {
        val store = NavigationSettingsStore(FakeBackend())
        assertTrue(store.skipFilledInWord)
        assertFalse(store.endOfWordIsNextClue)
        // DEFAULT is (skip filled, wrap to first blank): the exact pre-slice behavior.
        assertEquals(BoardNavigation.NavigationPrefs.DEFAULT, store.navigationPrefs)
    }

    @Test
    fun setters_persistThroughTheBackend_andMapToNavigationPrefs() {
        val backend = FakeBackend()
        val store = NavigationSettingsStore(backend)

        store.updateSkipFilledInWord(false)
        store.updateEndOfWordIsNextClue(true)

        assertFalse(store.skipFilledInWord)
        assertTrue(store.endOfWordIsNextClue)
        assertEquals(false, backend.map[NavigationSettingsStore.KEY_SKIP_FILLED])
        assertEquals(true, backend.map[NavigationSettingsStore.KEY_END_OF_WORD_NEXT_CLUE])

        assertEquals(
            BoardNavigation.NavigationPrefs(
                skipFilledInWord = false,
                endOfWord = BoardNavigation.EndOfWord.NEXT_CLUE,
            ),
            store.navigationPrefs,
        )
    }

    @Test
    fun roundTrip_aFreshStoreReadsWhatAPriorOneWrote() {
        val backend = FakeBackend()
        NavigationSettingsStore(backend).apply {
            updateSkipFilledInWord(false)
            updateEndOfWordIsNextClue(true)
        }

        // A cold start over the same backend rehydrates the persisted values, not the defaults.
        val restored = NavigationSettingsStore(backend)
        assertFalse(restored.skipFilledInWord)
        assertTrue(restored.endOfWordIsNextClue)
        assertEquals(BoardNavigation.EndOfWord.NEXT_CLUE, restored.navigationPrefs.endOfWord)
    }

    @Test
    fun providerLabel_mapsEachProvider_andNullWhenNoMarkerSurvived() {
        assertEquals("Discord", providerLabel(AuthProvider.DISCORD))
        assertEquals("Apple", providerLabel(AuthProvider.APPLE))
        assertEquals("Hisbaan", providerLabel(AuthProvider.HISBAAN))
        assertEquals("Email", providerLabel(AuthProvider.EMAIL_OTP))
        // No marker survived a restore: the card falls back to its own neutral line, never a
        // misreported provider.
        assertNull(providerLabel(null))
    }
}
