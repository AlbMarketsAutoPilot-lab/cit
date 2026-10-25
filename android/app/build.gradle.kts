plugins {
    id("com.android.application")
}

// IDs come from the environment (GitHub secrets). Without them: Google's public AdMob test IDs, no push.
fun env(name: String, fallback: String = ""): String = System.getenv(name)?.takeIf { it.isNotBlank() } ?: fallback

android {
    namespace = "com.calledit.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.calledit.app"
        minSdk = 26 // Android 8.0
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        manifestPlaceholders["admobAppId"] = env("ADMOB_APP_ID", "ca-app-pub-3940256099942544~3347511713")
        buildConfigField("String", "ADMOB_BANNER_ID", "\"${env("ADMOB_BANNER_ID", "ca-app-pub-3940256099942544/9214589741")}\"")
        buildConfigField("String", "ONESIGNAL_APP_ID", "\"${env("ONESIGNAL_APP_ID")}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("com.google.android.gms:play-services-ads:25.5.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
    implementation("com.onesignal:core:5.10.2")
    implementation("com.onesignal:notifications:5.10.2")
}
