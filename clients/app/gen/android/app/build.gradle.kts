import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("rust")
    id("com.google.gms.google-services")
}

android {
    compileSdk = 37
    namespace = "app.theone.client"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "app.theone.client"
        minSdk = 26
        targetSdk = 37
        // The build's name, as `tooling/version` says it, and its number, its count of commits, which Google Play takes as
        // its version code.
        val build = providers.exec { commandLine("sh", rootProject.file("../../../../tooling/version").path) }.standardOutput.asText.get().trim()
        versionCode = build.substringAfter('+').substringBefore('.').toInt()
        versionName = build
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        // A release build's code and resources are left as they're written, unshrunk: each network's APK is made from it
        // with apktool (`tooling/android-apk`), which can't build again resources R8 shrank (attributes it took out
        // that styles still name), and its Rust finds its Kotlin classes by their names through JNI.
        getByName("release") {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
        compose = true
    }
    // An app's native window, drawn by the renderer crate: its view, and Flutter's keyboard bridge.
    sourceSets["main"].java.srcDir("../../../renderer/android/src/main/java")
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // The app's own messaging service (Notifications.kt), at the version the push plugin brings.
    implementation(platform("com.google.firebase:firebase-bom:34.7.0"))
    implementation("com.google.firebase:firebase-messaging")
    // The home-screen widgets (Widgets.kt): Jetpack's way to draw them in Compose, which Android otherwise takes only
    // as RemoteViews.
    implementation("androidx.glance:glance-appwidget:1.2.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
