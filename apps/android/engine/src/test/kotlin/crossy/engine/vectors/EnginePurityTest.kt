package crossy.engine.vectors

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

// Engine purity guard (INV-9), the greppable-invariant twin of the iOS purity check. :engine's
// main source set must import nothing: no workspace modules, no libraries, no IO, no clock. The
// vector runner's JSON parsing lives in the test source set only. This test reads
// engine/build.gradle.kts and asserts every dependency configuration in the block is test-scoped,
// so the empty main dependency surface stays CI-visible, the same way the repo cites INV-n in
// test names everywhere else.
class EnginePurityTest {
    @Test
    fun mainDependencySurfaceStaysEmpty_INV9() {
        val buildFile = File(RepoLayout.engineModuleDir, "build.gradle.kts")
        assertTrue(buildFile.isFile, "engine/build.gradle.kts not found at ${buildFile.path}")
        val block = dependenciesBlock(buildFile.readText())
            ?: throw AssertionError("engine/build.gradle.kts has no dependencies { } block")

        // Each dependency line names its configuration first: `<config>(...)`. Any configuration
        // that is not test-scoped puts a symbol on the main classpath and breaks INV-9.
        val configurations = Regex("""(?m)^\s*([A-Za-z][A-Za-z0-9]*)\s*\(""")
            .findAll(block)
            .map { it.groupValues[1] }
            .toList()

        assertTrue(configurations.isNotEmpty(), "expected the vector runner's test dependencies in the block")
        val mainConfigurations = configurations.filterNot { it.startsWith("test") }
        assertTrue(mainConfigurations.isEmpty()) {
            "INV-9: :engine main source must import nothing, but engine/build.gradle.kts declares " +
                "main dependency configuration(s) $mainConfigurations"
        }
    }

    /** The body of the top-level `dependencies { ... }` block, matched by brace depth. */
    private fun dependenciesBlock(text: String): String? {
        val start = text.indexOf("dependencies")
        if (start == -1) return null
        val open = text.indexOf('{', start)
        if (open == -1) return null
        var depth = 0
        for (i in open until text.length) {
            when (text[i]) {
                '{' -> depth += 1
                '}' -> {
                    depth -= 1
                    if (depth == 0) return text.substring(open + 1, i)
                }
            }
        }
        return null
    }
}
