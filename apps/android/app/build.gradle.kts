// Composition root: wires adapters into stores and owns nothing else of substance.
// The only module allowed to import everything. The applicationId is a placeholder
// until the owner mints the Play identity (the first-time-provisioning exception).
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.compose.compiler)
}

android {
    namespace = "crossy.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "dev.crossy.android"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildFeatures { compose = true }
}

// Toolchain, not compileOptions: resolved via foojay so the build never depends on
// whatever JVM launched Gradle (the dev box ships a compiler-less JRE).
kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":engine"))
    implementation(project(":protocol"))
    implementation(project(":store"))
    implementation(project(":api"))
    implementation(project(":session"))
    implementation(project(":design"))
    implementation(project(":ui"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.kotlinx.coroutines.core)
}
