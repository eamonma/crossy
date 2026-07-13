// Adapter: OkHttp WebSocket transport implementing the store's transport port
// (CrossySession mirrored). Reconnect logic is store code under the vectors; this
// adapter only sleeps, jitters, and dials (AD-6).
plugins {
    alias(libs.plugins.kotlin.jvm)
}

kotlin { jvmToolchain(21) }

dependencies {
    implementation(project(":store"))
    implementation(project(":protocol"))
    implementation(libs.kotlinx.coroutines.core)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.okhttp.mockwebserver)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    // The integration harness (apps/android/scripts/integration.ts) injects CROSSY_IT_* connection
    // facts; StackIntegrationTests skips without them (assumeTrue). Forward them to the forked test
    // JVM, and record them as task inputs so a fresh gameId per run defeats the build cache: a
    // cached unit-only run must never mask the integration pass. Absent (CI, a plain
    // `:session:test`), the values are empty and the suite skips, so caching is unaffected.
    listOf("CROSSY_IT_WS_BASE", "CROSSY_IT_GAME_ID", "CROSSY_IT_TOKEN_A", "CROSSY_IT_TOKEN_B")
        .forEach { key ->
            val value = System.getenv(key)
            if (value != null) environment(key, value)
            inputs.property("it_$key", value ?: "")
        }
}
