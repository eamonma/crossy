// The AD-2 module graph, Android edition (apps/android/ARCHITECTURE.md). Arrows point
// inward only; a module dependency not declared in a build.gradle.kts is an unresolved
// import at compile time, so this workspace is its own dependency-cruiser, the same
// property Package.swift gives apps/ios.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    // Auto-provisions the JDK the toolchain blocks ask for, so a fresh clone needs
    // Gradle and nothing else (fresh-clone reproducibility, DESIGN.md §9).
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.10.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "crossy-android"

// Pure Kotlin/JVM (testable headlessly, no Android SDK)
include(":engine")
include(":protocol")
include(":store")
include(":api")
include(":session")
include(":design")

// Android (Compose)
include(":ui")
include(":app")
