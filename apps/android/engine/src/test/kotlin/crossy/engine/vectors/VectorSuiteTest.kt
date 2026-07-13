package crossy.engine.vectors

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.DynamicContainer.dynamicContainer
import org.junit.jupiter.api.DynamicNode
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory

// Conformance vector runner (PROTOCOL.md §13; conventions in vectors/README.md), the JVM twin of
// packages/engine/src/vectors.test.ts and apps/ios/Tests/VectorRunnerTests. Three concerns:
// discovery plus shape validation (hard pass/fail), the checked skip manifest, and gated
// execution that surfaces skips as aborted (skipped) dynamic tests. Every method that reads the
// tree calls `discover()`, so a malformed tree or an unrecognized family fails the build loudly
// rather than being silently skipped.
//
// Execution is per case: each vector case is one dynamic test named from the case name, so the
// run reports one result per case (hundreds), never a single opaque method per family. Only
// execution is gated by the manifest; discovery and shape validation are always hard.
class VectorSuiteTest {
    private val files = discover()
    private val manifest = loadSkipManifest()
    private val discoveredFamilies = files.map { it.family }.toSet()

    private fun byFamily(): Map<VectorFamily, List<DiscoveredFile>> = files.groupBy { it.family }

    // --- vector suite (INV-1: one shared suite drives every port) ---

    @Test
    fun discoversReducerAndNavigationFamilies_INV1() {
        assertTrue(discoveredFamilies.contains(VectorFamily.REDUCER), "vectors/v1/reducer/*.json not discovered")
        assertTrue(discoveredFamilies.contains(VectorFamily.NAVIGATION), "vectors/v1/navigation/*.json not discovered")
    }

    @Test
    fun discoversClientStoreFamilyAsForeign_INV10() {
        assertTrue(discoveredFamilies.contains(VectorFamily.CLIENT_STORE), "vectors/v1/client-store/*.json not discovered")
        assertTrue(manifest.foreignFamilies.contains(VectorFamily.CLIENT_STORE), "client-store must be a foreign family")
        // Foreign: never a skipped-until-engine family, never an engine binding. This is the
        // distinction the rebind relies on (PROTOCOL.md §13).
        assertFalse(manifest.families.contains(VectorFamily.CLIENT_STORE), "client-store is foreign, not skipped-until-engine")
        assertFalse(EngineBindings.bound.contains(VectorFamily.CLIENT_STORE), "client-store is foreign; it must never bind to :engine")
    }

    @Test
    fun navigationSingleCellAdvanceEncodesTwelveSeedCases_INV1() {
        val seed = files.firstOrNull { it.family == VectorFamily.NAVIGATION && it.cluster == "single-cell-advance" }
        assertNotNull(seed, "vectors/v1/navigation/single-cell-advance.json is missing")
        assertEquals(12, seed!!.cases.size, "PROTOCOL.md §13 pins exactly 12 seed cases")
    }

    // --- the skip manifest is checked, not trusted ---

    @Test
    fun everySkippedOrForeignFamilyHasVectorFilesOnDisk() {
        for (family in manifest.families + manifest.foreignFamilies) {
            assertTrue(
                discoveredFamilies.contains(family),
                "vectors.skip.json lists \"${family.dir}\" but no vectors/v1/${family.dir}/*.json exists; remove the dead entry",
            )
        }
    }

    @Test
    fun everyDiscoveredFamilyIsBoundSkippedOrForeign_INV1() {
        // The honest-failure guard: a family with vector files must be bound to the engine or
        // listed in the manifest. Silent skipping is forbidden (vectors/README.md).
        for (family in discoveredFamilies) {
            assertTrue(
                EngineBindings.bound.contains(family) ||
                    manifest.families.contains(family) ||
                    manifest.foreignFamilies.contains(family),
                "family \"${family.dir}\" has no engine binding and no vectors.skip.json entry; its cases would fail",
            )
        }
    }

    @Test
    fun aForeignFamilyIsNeverBoundToTheEngine() {
        for (family in manifest.foreignFamilies) {
            assertFalse(
                EngineBindings.bound.contains(family),
                "family \"${family.dir}\" is foreign but binds to :engine; foreign families run in their consumer's suite",
            )
        }
    }

    @Test
    fun eachEngineFamilyIsBoundIffDrainedFromManifest_INV1() {
        // A family the engine implements is bound here and absent from the manifest; a family
        // still awaiting the engine is unbound and listed. Never both, never neither. This holds
        // at every intermediate commit as the four families drain one at a time. Foreign
        // families are covered by their own guards above.
        for (family in discoveredFamilies) {
            if (manifest.foreignFamilies.contains(family)) continue
            val bound = EngineBindings.bound.contains(family)
            val skipped = manifest.families.contains(family)
            assertNotEquals(
                bound, skipped,
                "family \"${family.dir}\" must be bound-and-drained or unbound-and-skipped, not bound=$bound skipped=$skipped",
            )
        }
    }

    @Test
    fun aForeignFamilyRunThrowsNoEngineBinding() {
        // The remaining never-bound family is the foreign one: running it through the engine seam
        // must throw NoEngineBindingError, since its consumer is a client store, not :engine.
        // This keeps the honest-failure invariant with a live subject (PROTOCOL §13).
        val file = files.firstOrNull { manifest.foreignFamilies.contains(it.family) } ?: return
        val first = file.cases.first()
        assertFalse(EngineBindings.bound.contains(file.family), "${file.family.dir} is foreign; it must never bind to :engine")
        assertThrows(NoEngineBindingError::class.java) { EngineBindings.run(file.family, first) }
    }

    // --- shape conformance: one dynamic test per case, across every family (INV-1) ---

    @TestFactory
    fun everyCaseMatchesTheReadmeShape_INV1(): List<DynamicNode> =
        byFamily().map { (family, familyFiles) ->
            dynamicContainer(
                family.dir,
                familyFiles.map { file ->
                    dynamicContainer(
                        file.cluster,
                        file.cases.map { case ->
                            dynamicTest(caseLabel(family, case)) {
                                val problems = shapeProblems(family, case)
                                assertTrue(problems.isEmpty()) {
                                    "${family.dir}/${file.cluster}: ${caseLabel(family, case)} -> ${problems.joinToString("; ")}"
                                }
                            }
                        },
                    )
                },
            )
        }

    // --- execution against :engine: one dynamic test per case (hundreds) ---

    @TestFactory
    fun vectorExecutionAgainstTheEngine(): List<DynamicNode> =
        byFamily().filterKeys { !manifest.foreignFamilies.contains(it) }.map { (family, familyFiles) ->
            dynamicContainer(
                family.dir,
                familyFiles.map { file ->
                    dynamicContainer(
                        file.cluster,
                        file.cases.map { case ->
                            dynamicTest(caseLabel(family, case)) {
                                // A skipped-until-engine family surfaces as an aborted (skipped)
                                // dynamic test, never a silent pass. After the rebind this bucket
                                // is empty and every engine family executes.
                                assumeTrue(!manifest.families.contains(family)) {
                                    "${family.dir}: skipped, :engine unimplemented until it binds (vectors.skip.json)"
                                }
                                EngineBindings.run(family, case)
                            }
                        },
                    )
                },
            )
        }

    // --- foreign families: shape-validated above, execution lives in :store + :ui ---

    @TestFactory
    fun foreignFamiliesExecutedByTheirConsumer(): List<DynamicNode> =
        byFamily().filterKeys { manifest.foreignFamilies.contains(it) }.map { (family, familyFiles) ->
            dynamicContainer(
                "${family.dir} [foreign: :store + :ui]",
                familyFiles.map { file ->
                    dynamicContainer(
                        file.cluster,
                        file.cases.map { case ->
                            dynamicTest(caseLabel(family, case)) {
                                // Never executed here: its consumer is a client store, not :engine.
                                // Shape is validated by everyCaseMatchesTheReadmeShape above; this
                                // aborts (skips) so the case stays visible in the run summary.
                                assumeTrue(false) {
                                    "${family.dir} is foreign: shape-validated here, executed by :store + :ui, never :engine (vectors/README.md)"
                                }
                            }
                        },
                    )
                },
            )
        }
}
