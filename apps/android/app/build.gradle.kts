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

        // The invite host the share link is built against (PROTOCOL.md §12; api #222 serves it, iOS
        // #226 and web #225 emit it). Bare host, no scheme: ShareInvite prepends https. Domain
        // verification for App Links is owner-blocked (assetlinks.json + Play signing), so nothing
        // claims this host with an intent filter yet (PARITY.md: App Links for crossy.ing). Same in
        // every backend, so it stays in defaultConfig rather than the flavors below.
        buildConfigField("String", "INVITE_HOST", "\"crossy.ing\"")
    }

    // The backend a build dials, selected in Android Studio's Build Variants panel (devDebug ships
    // the local stack, prodDebug the live services). Every value below is public by design (INV-6
    // note, deploy/README.md) and committed, the config-as-code posture the iOS CrossyConfig.plist
    // already holds: no secrets, nothing dashboard-only. `dev` is alphabetically first, so it is the
    // default variant and a fresh checkout still points at the local stack; pick a `prod*` variant to
    // dial prod. Real per-build secret overrides (a Play signing config, a distinct applicationId)
    // arrive with the CI/secret build track; this only chooses which public origins the app talks to.
    flavorDimensions += "backend"
    productFlavors {
        // The local dev stack (e2e/scripts/dev-stack.ts: api 8790, session 8791, jwks/auth 8792).
        // 10.0.2.2 is the emulator's host loopback, so the app on the emulator reaches the stack on
        // the dev box. The issuer is NOT dialed: it is the token's `iss` claim string, minted by the
        // dev stack as 127.0.0.1 (the issuer trap, deploy/README.md), so it stays 127.0.0.1 while the
        // auth origin it is fetched from uses 10.0.2.2. The api key is a dev placeholder; the Turnstile
        // key is Cloudflare's documented always-pass TEST key, so the dev stack sends OTP out of the
        // box with no widget to provision (the web/.env.development posture). Empty would be the plain
        // pre-captcha send.
        create("dev") {
            dimension = "backend"
            buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:8790\"")
            buildConfigField("String", "SESSION_WS_BASE", "\"ws://10.0.2.2:8791\"")
            buildConfigField("String", "SUPABASE_AUTH_URL", "\"http://10.0.2.2:8792/auth/v1\"")
            buildConfigField("String", "SUPABASE_ISSUER", "\"http://127.0.0.1:8792/auth/v1\"")
            buildConfigField("String", "SUPABASE_API_KEY", "\"sb_publishable_dev_placeholder\"")
            buildConfigField("String", "TURNSTILE_SITE_KEY", "\"1x00000000000000000000AA\"")
        }
        // The live services (deploy/README.md's custom-domain cutover table; values mirror the iOS
        // CrossyConfig.plist verbatim). SUPABASE_AUTH_URL is the custom domain that fronts the auth
        // API (api.crossy.party), but SUPABASE_ISSUER is the REF domain (qvnvokstvbarsxhufrja
        // .supabase.co): tokens keep the ref-domain `iss` even under the custom domain, and the client
        // pins it (SupabaseAuthTests: a token whose `iss` disagrees is rejected before storage).
        // Setting the issuer to the custom domain is the trap that breaks every verify with
        // wrong-issuer. TURNSTILE_SITE_KEY is the real prod site key the iOS build committed.
        create("prod") {
            dimension = "backend"
            buildConfigField("String", "API_BASE_URL", "\"https://rest.crossy.party\"")
            buildConfigField("String", "SESSION_WS_BASE", "\"wss://session.crossy.party\"")
            buildConfigField("String", "SUPABASE_AUTH_URL", "\"https://api.crossy.party/auth/v1\"")
            buildConfigField("String", "SUPABASE_ISSUER", "\"https://qvnvokstvbarsxhufrja.supabase.co/auth/v1\"")
            buildConfigField("String", "SUPABASE_API_KEY", "\"sb_publishable_Ms9_XHXO1KwRAbtxM0JrSA_drJ0r7Pd\"")
            buildConfigField("String", "TURNSTILE_SITE_KEY", "\"0x4AAAAAADyxovx2eQsDvein\"")
        }
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
    // The launch window: androidx core-splashscreen installs the ground-colored splash and hands off
    // to Compose (MainActivity.installSplashScreen). Backports the API below 31, so minSdk 29 is fine.
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.kotlinx.coroutines.core)
    // The OAuth browser leg (Custom Tabs) and the resume-without-redirect busy clear live in the
    // composition root: browsers, intents, and lifecycles are :app concerns, never :ui's (AAD-2).
    implementation(libs.browser)
    implementation(libs.lifecycle.runtime.compose)
    // The composition root builds the REST client and the Supabase auth leg, whose constructors
    // take okhttp types (HttpUrl, OkHttpClient); :api keeps okhttp internal, so the root declares it.
    implementation(libs.okhttp)
}
