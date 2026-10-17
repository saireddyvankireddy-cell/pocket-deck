plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
// Keep generated files outside synced Documents when requested by the build host.
System.getenv("SAI_ANDROID_BUILD_DIR")?.takeIf { it.isNotBlank() }?.let { layout.buildDirectory.set(file(it)) }
android {
    namespace = "com.saireddy.saiai"
    compileSdk = 35
    testBuildType = "release"
    defaultConfig { applicationId = "com.saireddy.saiai"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0.0"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    // Personal sideload build: reuse the local debug signing identity, no secrets in source.
    buildTypes { release { isMinifyEnabled = false; isDebuggable = false; signingConfig = signingConfigs.getByName("debug") } }
    buildFeatures { buildConfig = true }
    packaging { resources.excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*") }
}
dependencies {
    // On-device inference: official Google LiteRT-LM runtime (bundled native libs, no NDK build).
    implementation("com.google.ai.edge.litertlm:litertlm-android:0.17.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
