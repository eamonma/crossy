package crossy.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// Scaffold smoke test: proves the module compiles and JUnit runs; replaced by the
// Wave A1 track's real suite.
class ProtocolSmokeTest {
    @Test
    fun moduleWiring() {
        assertEquals("protocol", ProtocolPlaceholder.MODULE)
    }
}
