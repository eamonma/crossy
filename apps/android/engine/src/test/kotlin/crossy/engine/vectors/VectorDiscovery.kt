package crossy.engine.vectors

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

// Discovery and the checked skip manifest, the JVM twin of VectorDiscovery.swift and the
// `discover`/`loadManifest` half of packages/engine/src/vectors.test.ts. Discovery is strict
// on purpose (vectors/README.md: skipping silently is forbidden): an unknown family, a stray
// file, or a file that is not a non-empty array of case objects throws instead of being
// skipped. Entries sort by name so the reported order is stable across platforms.

/** A vector assertion failure surfaced as a plain JUnit failure. */
class VectorMismatch(message: String) : AssertionError(message)

/** A discovery or manifest problem that stops the run loudly, never silently. */
class VectorDiscoveryError(message: String) : RuntimeException(message)

/**
 * Thrown by the engine seam for any family with no binding (after the rebind, only the foreign
 * client-store and clue-runs families). The foreign honest-failure guard matches on this type,
 * mirroring the Swift `.noEngineBinding` and the TS "no engine binding" message.
 */
class NoEngineBindingError(family: VectorFamily) :
    RuntimeException(
        "no engine binding for vector family \"${family.dir}\": it is foreign, its consumer is " +
            "a client store, not :engine",
    )

/** One discovered vector file: its family, cluster (basename without `.json`), and cases. */
data class DiscoveredFile(
    val family: VectorFamily,
    val cluster: String,
    val cases: List<JsonObject>,
)

fun discover(): List<DiscoveredFile> {
    val root = RepoLayout.vectorsV1
    val familyEntries = root.listFiles()?.sortedBy { it.name }
        ?: throw VectorDiscoveryError("vectors/v1 not found at ${root.path}")

    val files = mutableListOf<DiscoveredFile>()
    for (entry in familyEntries) {
        if (!entry.isDirectory) {
            throw VectorDiscoveryError("vectors/v1 must contain only family directories, found \"${entry.name}\"")
        }
        val family = VectorFamily.fromDir(entry.name)
            ?: throw VectorDiscoveryError(
                "unrecognized vector family \"${entry.name}\"; update vectors/README.md and this runner",
            )

        val clusterEntries = entry.listFiles()?.sortedBy { it.name } ?: emptyList()
        for (file in clusterEntries) {
            if (!file.isFile || !file.name.endsWith(".json")) {
                throw VectorDiscoveryError(
                    "vectors/v1/${family.dir} must contain only .json files, found \"${file.name}\"",
                )
            }
            val parsed = Json.parseToJsonElement(file.readText())
            val array = parsed as? JsonArray
            if (array == null || array.isEmpty() || array.any { it !is JsonObject }) {
                throw VectorDiscoveryError(
                    "vectors/v1/${family.dir}/${file.name} must be a non-empty JSON array of case objects",
                )
            }
            files.add(
                DiscoveredFile(
                    family = family,
                    cluster = file.name.removeSuffix(".json"),
                    cases = array.map { it.jsonObject },
                ),
            )
        }
    }
    return files
}

/**
 * The checked skip manifest, mirroring apps/ios/vectors.skip.json semantics. Two disjoint
 * buckets: `families` are skipped-until-engine (bound at Wave A1, then removed);
 * `foreignFamilies` have a consumer that is never :engine, so they are shape-validated but
 * never engine-bound and never leave the manifest. A listed name that is not a real family is a
 * hard error, and a family in both buckets is a hard error, so the manifest cannot drift.
 */
data class SkipManifest(
    val reason: String,
    val families: Set<VectorFamily>,
    val foreignReason: String,
    val foreignFamilies: Set<VectorFamily>,
)

fun loadSkipManifest(): SkipManifest {
    val obj = Json.parseToJsonElement(RepoLayout.skipManifest.readText()) as? JsonObject
        ?: throw VectorDiscoveryError(
            "vectors.skip.json must be { reason, families, foreign: { reason, families } }",
        )
    val reason = stringField(obj["reason"])
        ?: throw VectorDiscoveryError("vectors.skip.json must carry a string `reason`")
    val families = parseManifestFamilies(obj["families"], "families")

    // `foreign` is optional; absent means no foreign families.
    var foreignReason = ""
    var foreignFamilies = emptySet<VectorFamily>()
    val rawForeign = obj["foreign"]
    if (rawForeign != null) {
        val foreign = rawForeign as? JsonObject
            ?: throw VectorDiscoveryError(
                "vectors.skip.json `foreign` must be { reason: string, families: string[] }",
            )
        foreignReason = stringField(foreign["reason"])
            ?: throw VectorDiscoveryError(
                "vectors.skip.json `foreign` must be { reason: string, families: string[] }",
            )
        foreignFamilies = parseManifestFamilies(foreign["families"], "foreign.families")
    }

    val overlap = foreignFamilies intersect families
    if (overlap.isNotEmpty()) {
        throw VectorDiscoveryError(
            "vectors.skip.json family \"${overlap.first().dir}\" is both skipped-until-engine and " +
                "foreign; a family is one or the other",
        )
    }
    return SkipManifest(reason, families, foreignReason, foreignFamilies)
}

/** Parses one manifest family list; a name that is not a real family is a hard error. */
private fun parseManifestFamilies(raw: kotlinx.serialization.json.JsonElement?, where: String): Set<VectorFamily> {
    val array = raw as? JsonArray
        ?: throw VectorDiscoveryError("vectors.skip.json $where must be a string[]")
    return array.map { element ->
        val name = stringField(element)
        VectorFamily.fromDir(name ?: "")
            ?: throw VectorDiscoveryError("vectors.skip.json lists unknown family \"${name ?: element}\"")
    }.toSet()
}

private fun stringField(element: kotlinx.serialization.json.JsonElement?): String? =
    (element as? JsonPrimitive)?.takeIf { it.isString }?.content
