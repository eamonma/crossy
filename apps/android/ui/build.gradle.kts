// Adapter: Compose views — grid, key deck, chrome (CrossyUI mirrored). Imports store
// and design only, per the AD-2 graph; it renders what the store publishes and emits
// intents back, never touching transport or REST directly.
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.compose.compiler)
}

android {
    namespace = "crossy.ui"
    compileSdk = 36
    defaultConfig { minSdk = 29 }
    buildFeatures { compose = true }
    // The pure render helpers (CellFill, GridGeometry, InputActions) are JVM-testable with no
    // device: their smoke tests run on JUnit 5 as plain unit tests, matching the JVM modules.
    testOptions { unitTests.all { it.useJUnitPlatform() } }
}

// Toolchain, not compileOptions: resolved via foojay so the build never depends on
// whatever JVM launched Gradle (the dev box ships a compiler-less JRE). Pinned to 21 to match
// the JVM modules this consumes (:store, :protocol build at 21): the unit test runtime must load
// their class files, and a 17 runtime cannot read a 21-compiled dependency.
kotlin { jvmToolchain(21) }

dependencies {
    implementation(project(":store"))
    implementation(project(":design"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    // BackHandler for the check-vote card's predictive-back dismissal (Wave 15.12).
    implementation(libs.activity.compose)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.kotlinx.coroutines.core)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit.jupiter)
    // Test-only: virtual time for the reconnect-overlay grace flow (RoomWeatherGraceTests drives
    // RoomWeather.overlayGrace on the test scheduler, the SessionDriverTests idiom).
    testImplementation(libs.kotlinx.coroutines.test)
    // Test-only: the JVM twin of the vector readers, so TitleLabelsVectorTests can pin
    // TitleLadder's labels to vectors/analysis/title-labels.json (the DisplayNameVectorTests idiom).
    testImplementation(libs.kotlinx.serialization.json)
    testRuntimeOnly(libs.junit.platform.launcher)
}
