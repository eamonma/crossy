// Application: GameStore, optimistic overlay, reconciliation, connection state machine
// (AD-1 mirrored). Ports are defined here as interfaces; adapters implement them outward.
// Pinned by the shared client-store vector family — the drift fence with web and iOS.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(21) }

dependencies {
    api(project(":engine"))
    api(project(":protocol"))
    implementation(libs.kotlinx.coroutines.core)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.kotlinx.serialization.json)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test { useJUnitPlatform() }
