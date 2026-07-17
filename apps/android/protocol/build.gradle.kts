// Domain edge: kotlinx.serialization twins of every wire and REST payload
// (PROTOCOL.md §2–12), pinned by contract snapshots against packages/protocol —
// the D04 hand-kept-twin pattern, third consumer.
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

kotlin { jvmToolchain(21) }

dependencies {
    implementation(libs.kotlinx.serialization.json)
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test { useJUnitPlatform() }
