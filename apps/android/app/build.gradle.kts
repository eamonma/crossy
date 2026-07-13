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

        // Dev-stack defaults (e2e/scripts/dev-stack.ts: api 8790, session 8791, jwks/auth 8792).
        // 10.0.2.2 is the emulator's host loopback, so the app on the emulator reaches the stack on
        // the dev box. The issuer is NOT dialed: it is the token's `iss` claim string, minted by the
        // dev stack as 127.0.0.1 (the issuer trap, deploy/README.md), so it stays 127.0.0.1 while
        // the auth origin it is fetched from uses 10.0.2.2. Real values arrive via CI/secret build
        // variants; the api key is a dev placeholder.
        buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:8790\"")
        buildConfigField("String", "SESSION_WS_BASE", "\"ws://10.0.2.2:8791\"")
        buildConfigField("String", "SUPABASE_AUTH_URL", "\"http://10.0.2.2:8792/auth/v1\"")
        buildConfigField("String", "SUPABASE_ISSUER", "\"http://127.0.0.1:8792/auth/v1\"")
        buildConfigField("String", "SUPABASE_API_KEY", "\"sb_publishable_dev_placeholder\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

// Toolchain, not compileOptions: resolved via foojay so the build never depends on
// whatever JVM launched Gradle (the dev box ships a compiler-less JRE). Pinned to 21 to match the
// JVM modules the composition root consumes (:store, :api, :protocol build at 21), so the compile
// classpath can read their class files.
kotlin { jvmToolchain(21) }

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
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.kotlinx.coroutines.core)
    // The composition root builds the REST client and the Supabase auth leg, whose constructors
    // take okhttp types (HttpUrl, OkHttpClient); :api keeps okhttp internal, so the root declares it.
    implementation(libs.okhttp)
}
