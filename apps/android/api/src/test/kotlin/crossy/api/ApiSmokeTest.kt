package crossy.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// Scaffold smoke test: proves the module compiles and JUnit runs; replaced by the
// Wave A1 track's real suite.
class ApiSmokeTest {
    @Test
    fun moduleWiring() {
        assertEquals("api", ApiPlaceholder.MODULE)
    }
}
