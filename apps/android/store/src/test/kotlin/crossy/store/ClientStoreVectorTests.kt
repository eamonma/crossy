// The client-store conformance suite: executes every shared vector case against the real
// GameStore (PROTOCOL.md §13). This is the Android third of the drift fence (the same JSON runs in
// apps/web's vitest suite and apps/ios's XCTest suite) and the bound consumer that drains the
// `client-store` foreign family's execution debt (apps/android/vectors.skip.json): the engine
// vector runner shape-validates the family, this suite executes it. One dynamic test per case, so
// all 20 cases report individually (ARCHITECTURE.md: JUnit 5 dynamic tests per case).
//
// Coverage is guarded in the runner's "skipping silently is forbidden" ethos: the bound-cluster
// set must equal what discovery finds on disk (a new vector file fails until it is bound here), and
// the total case count is pinned exactly as the web and iOS runners pin it, so a case addition
// updates all three suites deliberately.

package crossy.store

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicContainer.dynamicContainer
import org.junit.jupiter.api.DynamicNode
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory

class ClientStoreVectorTests {
    /** Every cluster this suite executes. Discovery is checked against this set, so a vector file
     * cannot appear (or vanish) silently. */
    private val boundClusters = setOf(
        "echo-and-error",
        "first-fill-at",
        "local-command",
        "sequencing",
        "snapshot-reconciliation",
    )

    @Test
    fun everyClientStoreVectorFileOnDiskIsBoundToThisSuite_INV10() {
        assertEquals(
            boundClusters,
            ClientStoreVectors.discover().map { it.cluster }.toSet(),
            "vectors/v1/client-store and this suite's bound clusters must match exactly; " +
                "bind a new file, never skip it silently",
        )
    }

    @Test
    fun discoversAllTwentyCases_aVectorAdditionUpdatesThisCountDeliberately_INV10() {
        // Mirrors the web and iOS count guards: 14 Wave 1.1e cases plus 6 first-fill-at cases.
        val total = ClientStoreVectors.discover().sumOf { it.cases.size }
        assertEquals(20, total)
    }

    @TestFactory
    fun clientStoreVectorsExecuteAgainstTheRealStore_INV10(): List<DynamicNode> =
        ClientStoreVectors.discover().map { cluster ->
            dynamicContainer(
                "client-store/${cluster.cluster}",
                cluster.cases.map { case ->
                    dynamicTest(case.name) { runClientStoreCase(case) }
                },
            )
        }
}
