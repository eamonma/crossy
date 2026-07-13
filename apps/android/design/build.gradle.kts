// Adapter: design tokens — grounds, roster, type scale, motion constants (CrossyDesign
// mirrored). Pure values (ARGB ints, dp/sp scalars, durations); :ui maps them to Compose
// types. Kept JVM-pure so token twins are testable headlessly against the iOS/web values.
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(21) }

dependencies {
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test { useJUnitPlatform() }
