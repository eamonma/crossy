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
}

// Toolchain, not compileOptions: resolved via foojay so the build never depends on
// whatever JVM launched Gradle (the dev box ships a compiler-less JRE).
kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":store"))
    implementation(project(":design"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.lifecycle.runtime.compose)
    debugImplementation(libs.compose.ui.tooling)
}
