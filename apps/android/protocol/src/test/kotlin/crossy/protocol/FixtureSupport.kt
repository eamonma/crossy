package crossy.protocol

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import java.io.File

// Contract snapshot plumbing (the D04 hand-kept-twin pattern; ARCHITECTURE.md §9), the Kotlin
// twin of apps/ios FixtureSupport.swift. Fixtures are the checked-in JSON copied verbatim from
// apps/ios/Tests/CrossyProtocolTests/Fixtures (provenance noted in FIXTURES.md), so the TS codec
// tests and the Swift and Kotlin snapshots pin all three twins against the same normative bytes.
// Wire fixtures are the literal PROTOCOL.md examples with placeholders made concrete byte for
// byte as packages/protocol/src/codec.test.ts makes them; REST fixtures follow §12's field lists.

/** Fixture groups (= directory names under resources/fixtures). A closed set, like the vector
 *  runner's family enum: an unknown directory is a hard failure, never a silent skip. */
enum class FixtureGroup(val dir: String) {
    WIRE("wire"),
    REST("rest"),
}

object Fixtures {
    private fun resource(path: String) =
        Fixtures::class.java.getResource(path) ?: error("missing test resource $path")

    /** The raw JSON bytes of a checked-in fixture, decoded as UTF-8. */
    fun text(group: FixtureGroup, name: String): String =
        resource("/fixtures/${group.dir}/$name.json").readText()

    /** The fixture basenames on disk for a group. Strict: a non-.json entry throws, so a stray
     *  file cannot sit in the fixture tree unnoticed. */
    fun namesOnDisk(group: FixtureGroup): Set<String> {
        val dir = File(resource("/fixtures/${group.dir}").toURI())
        val entries = dir.listFiles() ?: error("fixtures/${group.dir} is not a directory")
        return entries.map { file ->
            require(file.name.endsWith(".json")) {
                "fixtures/${group.dir} must contain only .json files, found \"${file.name}\""
            }
            file.name.removeSuffix(".json")
        }.toSet()
    }
}

/**
 * Semantic JSON equality: object key order is not part of the contract (§2 frames are objects),
 * and numbers compare by value, so `60` and `60.0` match. This mirrors the Swift twin's
 * NSObject/NSNumber comparison (JSONSerialization graphs compared with isEqual), which is what
 * lets a Double field re-encode `60.0` against a fixture's integer literal `60` and still pin.
 */
fun jsonSemanticEquals(a: JsonElement, b: JsonElement): Boolean = when {
    a is JsonObject && b is JsonObject ->
        a.keys == b.keys && a.all { (key, value) -> jsonSemanticEquals(value, b.getValue(key)) }
    a is JsonArray && b is JsonArray ->
        a.size == b.size && a.indices.all { jsonSemanticEquals(a[it], b[it]) }
    a is JsonPrimitive && b is JsonPrimitive -> primitiveSemanticEquals(a, b)
    else -> false
}

private fun primitiveSemanticEquals(a: JsonPrimitive, b: JsonPrimitive): Boolean {
    val aNull = a is JsonNull
    val bNull = b is JsonNull
    if (aNull || bNull) return aNull && bNull
    if (a.isString != b.isString) return false
    if (a.isString) return a.content == b.content
    val an = a.content.toBigDecimalOrNull()
    val bn = b.content.toBigDecimalOrNull()
    return if (an != null && bn != null) an.compareTo(bn) == 0 else a.content == b.content
}

fun assertJsonEquivalent(expected: String, actual: String, message: String) {
    val equal = jsonSemanticEquals(
        ProtocolJson.parseToJsonElement(expected),
        ProtocolJson.parseToJsonElement(actual),
    )
    assertTrue(equal, "$message\n expected: $expected\n actual:   $actual")
}

/**
 * The core snapshot assertion: decode the fixture into the Kotlin twin, re-encode, and require
 * the result to reproduce the fixture's JSON (explicit nulls kept, absent optionals kept absent,
 * no field lost, none invented). Then require the re-encoded bytes to decode back to an equal
 * value, closing the loop.
 */
fun <T> assertLosslessRoundTrip(serializer: KSerializer<T>, group: FixtureGroup, name: String): T {
    val raw = Fixtures.text(group, name)
    val decoded = ProtocolJson.decodeFromString(serializer, raw)
    val reencoded = ProtocolJson.encodeToString(serializer, decoded)
    assertJsonEquivalent(
        raw, reencoded,
        "decode -> re-encode of fixtures/${group.dir}/$name.json must reproduce the fixture",
    )
    assertEquals(
        decoded, ProtocolJson.decodeFromString(serializer, reencoded),
        "re-decoding the re-encoded $name frame must be lossless",
    )
    return decoded
}

/** Wire-frame pinning: the concrete message round-trips, and the ClientMessage union routes the
 *  same frame to the same shape (the codec.ts decode switch, twinned). */
fun <T> pinClientFrame(serializer: KSerializer<T>, name: String): T {
    val decoded = assertLosslessRoundTrip(serializer, FixtureGroup.WIRE, name)
    val raw = Fixtures.text(FixtureGroup.WIRE, name)
    val union = ProtocolJson.decodeFromString(ClientMessageSerializer, raw)
    val reencoded = ProtocolJson.encodeToString(ClientMessageSerializer, union)
    assertJsonEquivalent(raw, reencoded, "ClientMessage union must round-trip fixtures/wire/$name.json")
    return decoded
}

/** Wire-frame pinning for the server direction, via the ServerMessage union. */
fun <T> pinServerFrame(serializer: KSerializer<T>, name: String): T {
    val decoded = assertLosslessRoundTrip(serializer, FixtureGroup.WIRE, name)
    val raw = Fixtures.text(FixtureGroup.WIRE, name)
    val union = ProtocolJson.decodeFromString(ServerMessageSerializer, raw)
    val reencoded = ProtocolJson.encodeToString(ServerMessageSerializer, union)
    assertJsonEquivalent(raw, reencoded, "ServerMessage union must round-trip fixtures/wire/$name.json")
    return decoded
}

/** Every JSON object key in a parsed document, recursively. Used by the INV-6 key sweep. */
fun allJsonKeys(value: JsonElement): List<String> = when (value) {
    is JsonObject -> value.flatMap { (key, nested) -> listOf(key) + allJsonKeys(nested) }
    is JsonArray -> value.flatMap { allJsonKeys(it) }
    else -> emptyList()
}

/** ASCII-only lowercasing (INV-1: no locale-aware transform, even inside a guard test). */
fun asciiLower(input: String): String =
    String(CharArray(input.length) { i ->
        val c = input[i]
        if (c in 'A'..'Z') c + 32 else c
    })
