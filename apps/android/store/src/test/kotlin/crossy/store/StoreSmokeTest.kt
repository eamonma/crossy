package crossy.store

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// Scaffold smoke test: proves the module compiles and JUnit runs; replaced by the
// Wave A1 track's real suite.
class StoreSmokeTest {
    @Test
    fun moduleWiring() {
        assertEquals("store", StorePlaceholder.MODULE)
    }
}
