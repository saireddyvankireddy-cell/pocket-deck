plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
// Keep generated files outside synced Documents when requested by the build host.
System.getenv("SAI_ANDROID_BUILD_DIR")?.takeIf { it.isNotBlank() }?.let { layout.buildDirectory.set(file(it)) }
android {
    namespace = "com.saiphotos.mobile"
    compileSdk = 35
    testBuildType = "release"
    defaultConfig { applicationId = "com.saiphotos.mobile"; minSdk = 26; targetSdk = 35; versionCode = 237; versionName = "1.28.6"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"; ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    // Reuse the existing personal-install identity so updates preserve device data.
    // Signing material is local and is never included in source backups.
    buildTypes { release { isMinifyEnabled = false; isDebuggable = false; signingConfig = signingConfigs.getByName("debug") } }
    buildFeatures { buildConfig = true }
    packaging { resources.excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*") }
}
dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.21.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:core:1.6.1")
}
