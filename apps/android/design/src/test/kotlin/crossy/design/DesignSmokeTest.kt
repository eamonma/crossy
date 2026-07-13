package crossy.design

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// Scaffold smoke test: proves the module compiles and JUnit runs; replaced by the
// Wave A1 track's real suite.
class DesignSmokeTest {
    @Test
    fun moduleWiring() {
        assertEquals("design", DesignPlaceholder.MODULE)
    }
}
