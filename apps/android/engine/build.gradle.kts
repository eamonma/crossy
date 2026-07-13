// Domain: reducer, navigation, comparator, completion — the third engine twin (INV-9).
// The empty main-source dependency surface below IS the invariant: no workspace modules,
// no libraries, no IO, no clock. Timestamps and user ids arrive as data. Test-only
// serialization is for the vector runner's JSON parsing, never for main sources.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(21) }

dependencies {
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.serialization.json)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test { useJUnitPlatform() }
