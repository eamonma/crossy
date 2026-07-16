// The receive-haptics preference store's round trip (Wave 7.5), run pure on the JVM
// (testProdDebugUnitTest): the persistence is behind the ReactionPrefsBackend port, so an in-memory
// fake stands in for SharedPreferences and no device is involved. What this pins: the default reads an
// unset key as ON (iOS's default-true fallback), the setter persists, and a fresh store reads what a
// prior one wrote. Twin of the iOS ReactionSettings contract.

package crossy.app

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ReactionSettingsStoreTests {
    private class FakeBackend(val map: MutableMap<String, Boolean> = mutableMapOf()) :
        ReactionPrefsBackend {
        override fun getBoolean(key: String, default: Boolean): Boolean = map[key] ?: default
        override fun putBoolean(key: String, value: Boolean) {
            map[key] = value
        }
    }

    @Test
    fun default_isOn_soAnUnsetDeviceFeelsTheReceiveTap() {
        val store = ReactionSettingsStore(FakeBackend())
        assertTrue(store.receiveHapticsEnabled)
    }

    @Test
    fun setter_persistsThroughTheBackend() {
        val backend = FakeBackend()
        val store = ReactionSettingsStore(backend)

        store.updateReceiveHapticsEnabled(false)

        assertFalse(store.receiveHapticsEnabled)
        // A fresh store over the same backend reads what the prior one wrote (the survives-relaunch rule).
        assertFalse(ReactionSettingsStore(backend).receiveHapticsEnabled)
    }

    @Test
    fun setter_restoresOn() {
        val backend = FakeBackend()
        val store = ReactionSettingsStore(backend)

        store.updateReceiveHapticsEnabled(false)
        store.updateReceiveHapticsEnabled(true)

        assertTrue(store.receiveHapticsEnabled)
        assertTrue(ReactionSettingsStore(backend).receiveHapticsEnabled)
    }
}
