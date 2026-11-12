plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.managepro.app"
    compileSdk = 34

    defaultConfig {
        minSdk = 29                 // Android 10+ : enregistrement des fichiers sans permission de stockage
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
        applicationId = "com.managepro.app"

        // >>> Adresse du site : modifiez ici UNIQUEMENT (sans paramètre ?utm_source=...)
        buildConfigField("String", "BASE_URL", "\"https://manager-pro-669w.onrender.com/\"")
        buildConfigField("String", "SITE_HOST", "\"manager-pro-669w.onrender.com\"")
        buildConfigField("String", "UA_TAG", "\"ManageProApp\"")
        buildConfigField("String", "DOWNLOAD_DIR", "\"ManagePro\"")
        buildConfigField("boolean", "SESSION_SYNC", "true")
        buildConfigField("boolean", "ALERTS", "true")
        buildConfigField("boolean", "BT_PRINT", "true")
        buildConfigField("boolean", "POLYFILLS", "false")
        manifestPlaceholders["siteHost"] = "manager-pro-669w.onrender.com"
    }


    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Signature : voir README (keystore.properties) ; sans clé, l'APK release n'est pas installable.
        }
        debug { applicationIdSuffix = ".debug"; versionNameSuffix = "-debug" }
    }
    buildFeatures { buildConfig = true; viewBinding = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.biometric:biometric:1.1.0")                       // verrouillage empreinte / code
    implementation("androidx.work:work-runtime-ktx:2.9.1")                    // notifications (vérification périodique)
    implementation("com.google.android.gms:play-services-code-scanner:16.1.0") // scan code-barres sans permission caméra
}
