package crossy.engine.vectors

import java.io.File

// Locates the shared vector tree and this module's skip manifest by walking up from the
// module directory, the JVM twin of RepoLayout in apps/ios/Tests/VectorRunnerTests. Swift
// uses the compiled-in `#filePath`; the JVM has no such literal, so the runner ascends from
// the test working directory (the `:engine` project dir under Gradle) until it finds the
// directory that holds `vectors/v1`. That directory is the repo root, and `apps/android`
// sits beside `vectors/`.
object RepoLayout {
    val repoRoot: File = findRepoRoot()
    val vectorsV1: File = File(repoRoot, "vectors/v1")
    val appsAndroid: File = File(repoRoot, "apps/android")
    val engineModuleDir: File = File(appsAndroid, "engine")

    // The manifest lives at the app root, beside its iOS twin (apps/ios/vectors.skip.json),
    // not inside the engine module.
    val skipManifest: File = File(appsAndroid, "vectors.skip.json")

    private fun findRepoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            if (File(dir, "vectors/v1").isDirectory) return dir
            dir = dir.parentFile
        }
        error(
            "could not locate the repo root (a directory containing vectors/v1) by walking up " +
                "from ${System.getProperty("user.dir")}",
        )
    }
}
