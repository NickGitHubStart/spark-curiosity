import com.google.firebase.appdistribution.gradle.firebaseAppDistribution
import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
    id("com.google.firebase.appdistribution")
}

// If this file exists, Gradle uses it for uploads (stable; no FIREBASE_TOKEN expiry).
// Create in Google Cloud: IAM → Service accounts → key JSON. Role: Firebase App Distribution Admin.
// File is gitignored — see firebase-setup.txt section "Dauerhaft (Service Account)".
val firebaseAppDistributionServiceAccount: File =
    rootProject.file("firebase-app-distribution-sa.json")

android {
    namespace = "com.sparkcuriosity.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.sparkcuriosity.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        // Cloud proxy base URL — points to the Cloudflare Worker
        buildConfigField("String", "CLOUD_BASE_URL", "\"https://spark-proxy.spark-curiosity.workers.dev\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            firebaseAppDistribution {
                artifactType = "AAB"
                groups = "SparkCuriosityAndroidTester"
                releaseNotesFile =
                    rootProject.file("appdistribution-release-notes.txt").absolutePath
                if (firebaseAppDistributionServiceAccount.exists()) {
                    serviceCredentialsFile =
                        firebaseAppDistributionServiceAccount.absolutePath
                }
            }
        }
        debug {
            isDebuggable = true
            firebaseAppDistribution {
                artifactType = "APK"
                groups = "SparkCuriosityAndroidTester"
                releaseNotesFile =
                    rootProject.file("appdistribution-release-notes.txt").absolutePath
                if (firebaseAppDistributionServiceAccount.exists()) {
                    serviceCredentialsFile =
                        firebaseAppDistributionServiceAccount.absolutePath
                }
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    // Compose BOM
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")

    // Networking
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.moshi:moshi:1.15.1")
    implementation("com.squareup.moshi:moshi-kotlin:1.15.1")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // DataStore (token persistence)
    implementation("androidx.datastore:datastore-preferences:1.1.2")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // Core
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-process:2.8.7")
    implementation("androidx.savedstate:savedstate-ktx:1.2.1")

    // QR pairing (display + scan)
    implementation("com.google.zxing:core:3.5.3")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")

    // WorkManager for periodic health checks
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    // Debug
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
