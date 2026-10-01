"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mobileCi = exports.checkAndroidToolchain = exports.detectVersions = exports.versionGte = exports.RN_MATRIX = exports.FLUTTER_MATRIX = exports.XCODE_MATRIX = exports.GRADLE_MAX_JDK = exports.AGP_MATRIX = exports.ANDROID_LEVELS = exports.firstErrorLines = exports.explainBuildLog = exports.KNOWN_ERRORS = exports.pinningSnippets = exports.parseCertificates = exports.convertFingerprint = exports.keystoreCommands = void 0;
const crypto_1 = require("crypto");
const yaml_1 = __importDefault(require("yaml"));
const types_1 = require("../types");
function keystoreCommands(o) {
    const dname = `CN=${o.dname.cn}, O=${o.dname.o}, C=${o.dname.c}`;
    const days = Math.round(o.validityYears * 365.25);
    return {
        create: `# Creates an upload key. Store the file and passwords in a password manager - losing them means you cannot update the app\n# (with Play App Signing you can request an upload key reset; without it the app is lost).\nkeytool -genkeypair -v \\\n  -keystore ${o.file} \\\n  -storetype PKCS12 \\\n  -alias ${o.alias} \\\n  -keyalg RSA -keysize 2048 \\\n  -validity ${days} \\\n  -dname "${dname}"`,
        fingerprints: `# Release / upload key\nkeytool -list -v -keystore ${o.file} -alias ${o.alias}\n\n# Debug key (password: android)\nkeytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android\n\n# Every variant's signing certificate, from the project\ncd android && ./gradlew signingReport\n\n# Of an APK / AAB you already built\nkeytool -printcert -jarfile app-release.aab\napksigner verify --print-certs app-release.apk`,
        properties: `# android/key.properties - never commit this file\nstorePassword=<store password>\nkeyPassword=<key password>\nkeyAlias=${o.alias}\nstoreFile=${o.file.includes("/") ? o.file : `../${o.file}`}\n`,
        gradleKts: `// android/app/build.gradle.kts\nimport java.util.Properties\nimport java.io.FileInputStream\n\nval keystoreProperties = Properties().apply {\n    val file = rootProject.file("key.properties")\n    if (file.exists()) load(FileInputStream(file))\n}\n\nandroid {\n    signingConfigs {\n        create("release") {\n            // Locally from key.properties; on CI from environment variables.\n            storeFile = (keystoreProperties["storeFile"] as String? ?: System.getenv("ANDROID_KEYSTORE_PATH"))?.let { file(it) }\n            storePassword = keystoreProperties["storePassword"] as String? ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")\n            keyAlias = keystoreProperties["keyAlias"] as String? ?: System.getenv("ANDROID_KEY_ALIAS")\n            keyPassword = keystoreProperties["keyPassword"] as String? ?: System.getenv("ANDROID_KEY_PASSWORD")\n        }\n    }\n    buildTypes {\n        getByName("release") {\n            signingConfig = signingConfigs.getByName("release")\n            isMinifyEnabled = true\n            isShrinkResources = true\n            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")\n        }\n    }\n}\n`,
        gradleGroovy: `// android/app/build.gradle\ndef keystoreProperties = new Properties()\ndef keystorePropertiesFile = rootProject.file('key.properties')\nif (keystorePropertiesFile.exists()) {\n    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))\n}\n\nandroid {\n    signingConfigs {\n        release {\n            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null\n            storePassword keystoreProperties['storePassword']\n            keyAlias keystoreProperties['keyAlias']\n            keyPassword keystoreProperties['keyPassword']\n        }\n    }\n    buildTypes {\n        release {\n            signingConfig signingConfigs.release\n            minifyEnabled true\n            shrinkResources true\n        }\n    }\n}\n`,
        ci: `# Store the keystore as a GitHub secret (base64), never in the repository\nbase64 -i ${o.file} | pbcopy          # macOS (Linux: base64 -w0 ${o.file})\n# Secrets: ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD\n\n# Workflow step\n- name: Decode keystore\n  run: |\n    echo "\${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 --decode > \${{ runner.temp }}/upload.jks\n    echo "ANDROID_KEYSTORE_PATH=\${{ runner.temp }}/upload.jks" >> "$GITHUB_ENV"`,
        ios: `# Signing identities in the keychain\nsecurity find-identity -v -p codesigning\n\n# Inspect a provisioning profile (team, bundle id, devices, expiry, entitlements)\nsecurity cms -D -i profile.mobileprovision | plutil -p -\n\n# Export a certificate + key for CI: Keychain Access → My Certificates → right-click → Export (.p12), then\nbase64 -i Certificates.p12 | pbcopy\n\n# Recommended on teams: fastlane match keeps certificates and profiles in a private repo or bucket\nfastlane match init\nfastlane match appstore\nfastlane match development\n\n# Check what an .ipa is signed with\nunzip -q App.ipa -d /tmp/ipa && codesign -dvvv /tmp/ipa/Payload/*.app && codesign -d --entitlements :- /tmp/ipa/Payload/*.app`
    };
}
exports.keystoreCommands = keystoreCommands;
function convertFingerprint(input) {
    const t = input.trim().replace(/^(SHA-?1|SHA-?256)\s*[:=]?\s*/i, "");
    let buf;
    const hex = t.replace(/[\s:]/g, "");
    if (/^[0-9a-f]+$/i.test(hex) && (hex.length === 40 || hex.length === 64))
        buf = Buffer.from(hex, "hex");
    else if (/^[A-Za-z0-9+/_-]+=*$/.test(t)) {
        const b = Buffer.from(t.replace(/-/g, "+").replace(/_/g, "/"), "base64");
        if (b.length === 20 || b.length === 32)
            buf = b;
    }
    if (!buf)
        throw new types_1.ToolInputError("Paste a SHA-1 (20 bytes) or SHA-256 (32 bytes) fingerprint as hex (with or without colons) or Base64 (e.g. a Facebook key hash).");
    const h = buf.toString("hex").toUpperCase();
    return { bytes: buf.length, algorithm: buf.length === 20 ? "SHA-1" : "SHA-256", colonHex: h.match(/../g).join(":"), hex: h.toLowerCase(), base64: buf.toString("base64"), base64url: buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") };
}
exports.convertFingerprint = convertFingerprint;
function parseCertificates(pem, now) {
    const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (!blocks) {
        const b64 = pem.replace(/\s+/g, "");
        if (/^[A-Za-z0-9+/]+=*$/.test(b64) && b64.length > 200)
            return parseCertificates(`-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g).join("\n")}\n-----END CERTIFICATE-----`, now);
        throw new types_1.ToolInputError("Paste one or more PEM certificates (-----BEGIN CERTIFICATE----- …). To get a server's chain: openssl s_client -connect host:443 -servername host -showcerts </dev/null");
    }
    return blocks.map(block => {
        let cert;
        try {
            cert = new crypto_1.X509Certificate(block.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----/g, m => `\n${m}\n`).replace(/\n{2,}/g, "\n").trim() + "\n");
        }
        catch (error) {
            throw new types_1.ToolInputError(`A certificate could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
        }
        const spki = cert.publicKey.export({ type: "spki", format: "der" });
        const details = cert.publicKey.asymmetricKeyDetails;
        const keyType = `${(cert.publicKey.asymmetricKeyType ?? "?").toUpperCase()}${details?.modulusLength ? ` ${details.modulusLength}-bit` : details?.namedCurve ? ` ${details.namedCurve}` : ""}`;
        const validFrom = new Date(cert.validFrom);
        const validTo = new Date(cert.validTo);
        return {
            subject: cert.subject.replace(/\n/g, ", "),
            issuer: cert.issuer.replace(/\n/g, ", "),
            sans: (cert.subjectAltName ?? "").split(/,\s*/).filter(Boolean),
            validFrom,
            validTo,
            daysLeft: Math.floor((validTo.getTime() - now.getTime()) / 86400000),
            serial: cert.serialNumber,
            keyType,
            sha1: cert.fingerprint,
            sha256: cert.fingerprint256,
            spkiPin: (0, crypto_1.createHash)("sha256").update(spki).digest("base64"),
            selfSigned: cert.subject === cert.issuer,
            ca: cert.ca
        };
    });
}
exports.parseCertificates = parseCertificates;
function pinningSnippets(host, pins, expiry) {
    const h = host || "api.example.com";
    return {
        okhttp: `import okhttp3.CertificatePinner\nimport okhttp3.OkHttpClient\n\n// Pin at least two keys (current + backup) or a key rotation will break every installed app.\nval certificatePinner = CertificatePinner.Builder()\n${pins.map(p => `    .add("${h}", "sha256/${p}")`).join("\n")}\n    .build()\n\nval client = OkHttpClient.Builder()\n    .certificatePinner(certificatePinner)\n    .build()\n`,
        android: `<?xml version="1.0" encoding="utf-8"?>\n<!-- res/xml/network_security_config.xml; reference it with android:networkSecurityConfig on <application> -->\n<network-security-config>\n    <domain-config>\n        <domain includeSubdomains="true">${h}</domain>\n        <pin-set expiration="${expiry}">\n${pins.map(p => `            <pin digest="SHA-256">${p}</pin>`).join("\n")}\n        </pin-set>\n    </domain-config>\n</network-security-config>\n`,
        ios: `<!-- Info.plist (iOS 14+): NSPinnedDomains -->\n<key>NSAppTransportSecurity</key>\n<dict>\n    <key>NSPinnedDomains</key>\n    <dict>\n        <key>${h}</key>\n        <dict>\n            <key>NSIncludesSubdomains</key>\n            <true/>\n            <key>NSPinnedLeafIdentities</key>\n            <array>\n${pins.map(p => `                <dict>\n                    <key>SPKI-SHA256-BASE64</key>\n                    <string>${p}</string>\n                </dict>`).join("\n")}\n            </array>\n        </dict>\n    </dict>\n</dict>\n`,
        openssl: `# Fetch the chain\nopenssl s_client -connect ${h}:443 -servername ${h} -showcerts </dev/null 2>/dev/null | openssl x509 -outform PEM > server.pem\n\n# SPKI pin of a certificate (same value as above)\nopenssl x509 -in server.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64\n\n# Expiry\nopenssl x509 -in server.pem -noout -enddate`
    };
}
exports.pinningSnippets = pinningSnippets;
exports.KNOWN_ERRORS = [
    // Android / Gradle
    { id: "class-version", platform: "Android / Gradle", re: /Unsupported class file major version (\d+)|has been compiled by a more recent version of the Java Runtime \(class file version (\d+)/i, title: "JDK too new (or too old) for this Gradle / tool", cause: "Gradle or a plugin runs on a JDK it does not support. Class file versions: 55 = Java 11, 61 = Java 17, 65 = Java 21, 67 = Java 23, 68 = Java 24, 69 = Java 25.", fix: "Use JDK 17 for AGP 8.x (Android Studio's bundled JBR is fine): set org.gradle.java.home in gradle.properties or JAVA_HOME, or Android Studio → Settings → Build Tools → Gradle → Gradle JDK. Or upgrade Gradle in gradle/wrapper/gradle-wrapper.properties (Java 21 needs Gradle 8.5+)." },
    { id: "agp-java17", platform: "Android / Gradle", re: /Android Gradle plugin requires Java (\d+) to run/i, title: "AGP needs a newer JDK", cause: "AGP 8.0+ requires JDK 17 to run.", fix: "Install JDK 17 and point Gradle at it (JAVA_HOME, org.gradle.java.home or Android Studio's Gradle JDK setting). Flutter: flutter config --jdk-dir <path-to-jdk17>." },
    { id: "min-gradle", platform: "Android / Gradle", re: /Minimum supported Gradle version is ([\d.]+)/i, title: "Gradle wrapper is too old for this AGP", cause: "Each Android Gradle Plugin version needs a minimum Gradle version.", fix: "Update distributionUrl in gradle/wrapper/gradle-wrapper.properties to the version shown (e.g. https\\://services.gradle.org/distributions/gradle-8.13-bin.zip), or run ./gradlew wrapper --gradle-version <version>." },
    { id: "namespace", platform: "Android / Gradle", re: /Namespace not specified/i, title: "Missing namespace (AGP 8)", cause: "AGP 8 moved the package from AndroidManifest.xml to the namespace property; an app module or an old library has none.", fix: "Add namespace = \"com.example.app\" in the android { } block. For an outdated Flutter/RN plugin, upgrade it; as a stopgap set the namespace for that subproject in android/build.gradle." },
    { id: "minsdk", platform: "Android / Gradle", re: /uses-sdk:minSdkVersion (\d+) cannot be smaller than version (\d+) declared in library/i, title: "minSdk lower than a library requires", cause: "A dependency needs a higher minimum Android version than the app declares.", fix: "Raise minSdk in android/app/build.gradle(.kts) (Flutter: flutter.minSdkVersion or an explicit number; Expo: expo-build-properties android.minSdkVersion) to at least the library's value." },
    { id: "aar-metadata", platform: "Android / Gradle", re: /checkDebugAarMetadata|requires libraries and applications that depend on it to compile against version (\d+) or later/i, title: "compileSdk too low for a dependency", cause: "An AndroidX or plugin dependency needs a newer compileSdk.", fix: "Raise compileSdk (and usually targetSdk) to the version mentioned, and make sure your AGP version supports it." },
    { id: "duplicate-class", platform: "Android / Gradle", re: /Duplicate class ([\w.$]+) found in modules/i, title: "Duplicate classes from two dependencies", cause: "Two libraries ship the same classes - often old support libraries next to AndroidX, or kotlin-stdlib-jdk7/jdk8 next to a newer kotlin-stdlib.", fix: "Run ./gradlew app:dependencies to find both sources, then exclude one, align versions with a BOM, or add android.enableJetifier=true for old support libraries. For kotlin-stdlib duplicates, upgrade the Kotlin Gradle plugin." },
    { id: "resolve", platform: "Android / Gradle", re: /Could not resolve all (files|dependencies|artifacts) for configuration|Could not find ([\w.-]+:[\w.-]+:[\w.-]+)/i, title: "Dependency could not be downloaded", cause: "The artifact does not exist in the configured repositories, the version is wrong, or the network/proxy blocks Maven.", fix: "Check the coordinates and version, make sure google() and mavenCentral() are in settings.gradle(.kts) dependencyResolutionManagement, retry with ./gradlew --refresh-dependencies, and check proxy settings in gradle.properties. JCenter is shut down - replace jcenter()." },
    { id: "dex", platform: "Android / Gradle", re: /Cannot fit requested classes in a single dex file|The number of method references in a \.dex file cannot exceed 64K/i, title: "64K method limit", cause: "minSdk below 21 without multidex.", fix: "Raise minSdk to 21+ (multidex is automatic) or enable multiDexEnabled true; also enable R8 shrinking for release." },
    { id: "kotlin-meta", platform: "Android / Gradle", re: /Module was compiled with an incompatible version of Kotlin\. The binary version of its metadata is ([\d.]+), expected version is ([\d.]+)/i, title: "Kotlin Gradle plugin too old", cause: "A dependency was compiled with a newer Kotlin than your project's Kotlin Gradle plugin.", fix: "Upgrade the Kotlin plugin (org.jetbrains.kotlin.android / ext.kotlin_version, Flutter: android/settings.gradle) to at least the binary version shown." },
    { id: "compose-compiler", platform: "Android / Gradle", re: /Starting in Kotlin 2\.0, the Compose Compiler Gradle plugin is required|compose compiler.*requires Kotlin version/i, title: "Compose compiler setup for Kotlin 2", cause: "Kotlin 2.0+ ships the Compose compiler as a Gradle plugin.", fix: "Add id(\"org.jetbrains.kotlin.plugin.compose\") version \"<your Kotlin version>\" and remove composeOptions.kotlinCompilerExtensionVersion." },
    { id: "exported", platform: "Android / Gradle", re: /android:exported needs to be explicitly specified/i, title: "android:exported missing (targetSdk 31+)", cause: "Since Android 12, every activity, service or receiver with an intent-filter must declare android:exported.", fix: "Add android:exported=\"true\" to the launcher activity (and false to components that should not be reachable from other apps); update old libraries that declare components." },
    { id: "16kb", platform: "Android / Gradle", re: /16 ?KB|not 16 KB aligned|page size/i, title: "16 KB page size compatibility", cause: "Google Play requires apps targeting Android 15+ to support 16 KB memory pages (since 1 Nov 2025); native .so libraries must be built with 16 KB alignment.", fix: "Use AGP 8.5.1+ (uncompressed, aligned native libs), NDK r28+ or -Wl,-z,max-page-size=16384, and update native dependencies (React Native 0.77+, recent Flutter). Check with Android Studio's APK Analyzer." },
    { id: "daemon-oom", platform: "Android / Gradle", re: /Java heap space|GC overhead limit exceeded|Gradle build daemon disappeared unexpectedly|Expiring Daemon because JVM heap space is exhausted/i, title: "Gradle ran out of memory", cause: "The Gradle daemon or Kotlin compiler hit its heap limit.", fix: "In gradle.properties: org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8 (and kotlin.daemon.jvmargs=-Xmx2g); close other heavy apps; on CI use a larger runner." },
    { id: "sdk-location", platform: "Android / Gradle", re: /SDK location not found|ANDROID_HOME|ANDROID_SDK_ROOT/i, title: "Android SDK not found", cause: "Gradle cannot find the SDK path.", fix: "Create android/local.properties with sdk.dir=/Users/<you>/Library/Android/sdk (Windows: C\\:\\\\Users\\\\<you>\\\\AppData\\\\Local\\\\Android\\\\Sdk) or export ANDROID_HOME." },
    { id: "license", platform: "Android / Gradle", re: /You have not accepted the license agreements|licen[cs]es? .*not been accepted/i, title: "SDK licences not accepted", cause: "A required SDK package's licence is pending.", fix: "Run sdkmanager --licenses (or flutter doctor --android-licenses) and accept all." },
    { id: "install-failed", platform: "Android / device", re: /INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i, title: "Installed app is signed with another key", cause: "An app with the same package name but a different signing key (e.g. a Play Store build vs a debug build) is installed.", fix: "Uninstall it first: adb uninstall <package>. Use applicationIdSuffix \".debug\" so debug and release can coexist." },
    { id: "install-sdk", platform: "Android / device", re: /INSTALL_FAILED_OLDER_SDK/i, title: "Device is older than minSdk", cause: "The device's Android version is below the app's minSdk.", fix: "Use a newer emulator image or lower minSdk if your dependencies allow it." },
    { id: "cleartext", platform: "Android / device", re: /CLEARTEXT communication to .* not permitted|Cleartext HTTP traffic to .* not permitted/i, title: "HTTP blocked by Android", cause: "Android 9+ blocks plain http:// by default.", fix: "Use https, or allow cleartext only for dev hosts in a debug-only network_security_config.xml (see the Local API Access tool)." },
    // iOS / Xcode / CocoaPods
    { id: "pods-sync", platform: "iOS / CocoaPods", re: /The sandbox is not in sync with the Podfile\.lock/i, title: "Pods out of date", cause: "Podfile.lock changed (e.g. after a pull) but pod install has not run.", fix: "cd ios && pod install. Always open the .xcworkspace, not the .xcodeproj." },
    { id: "pods-compat", platform: "iOS / CocoaPods", re: /CocoaPods could not find compatible versions for pod|required a higher minimum deployment target/i, title: "Pod version or deployment target conflict", cause: "Two pods need incompatible versions, or a pod needs a higher iOS deployment target than the Podfile platform.", fix: "Raise platform :ios in the Podfile (and IPHONEOS_DEPLOYMENT_TARGET), then cd ios && pod repo update && pod install. If still stuck: rm -rf Pods Podfile.lock && pod install --repo-update." },
    { id: "pods-ffi", platform: "iOS / CocoaPods", re: /ffi_c\.bundle|incompatible architecture.*ffi|LoadError.*ffi/i, title: "CocoaPods / Ruby ffi architecture mismatch", cause: "Ruby gems were built for x86_64 (Rosetta) on an Apple Silicon Mac or vice versa.", fix: "Use a Homebrew or rbenv Ruby and reinstall: brew install cocoapods (or gem install cocoapods with a non-system Ruby). Bundler: bundle install && bundle exec pod install." },
    { id: "rsync-sandbox", platform: "iOS / Xcode", re: /Sandbox: rsync(\.samba)?\(\d+\) deny\(1\) file-write-create/i, title: "Xcode 15 user script sandboxing", cause: "ENABLE_USER_SCRIPT_SANDBOXING blocks build phase scripts (CocoaPods frameworks, Flutter) from writing files.", fix: "Build Settings → User Script Sandboxing → No for the app target (or update CocoaPods to 1.15+ and re-run pod install)." },
    { id: "signing-team", platform: "iOS / Xcode", re: /Signing for "[^"]+" requires a development team|No signing certificate "[^"]+" found|No profiles for '[^']+' were found/i, title: "Code signing not configured", cause: "No team, certificate or provisioning profile for this bundle ID and configuration.", fix: "Xcode → target → Signing & Capabilities → choose your Team and enable Automatically manage signing. On CI, install the certificate and profile (fastlane match or a keychain import step) and pass DEVELOPMENT_TEAM." },
    { id: "provisioning-caps", platform: "iOS / Xcode", re: /Provisioning profile "[^"]+" doesn't (include|support) the ([\w ]+) capability|doesn't include the com\.apple\.developer/i, title: "Capability missing from the profile", cause: "An entitlement (push, associated domains, Sign in with Apple…) is enabled in the app but not on the App ID / profile.", fix: "Enable the capability for the App ID in the developer portal and regenerate the profile (automatic signing does this; with match run fastlane match --force)." },
    { id: "module-map", platform: "iOS / Xcode", re: /module map file '[^']+' not found|No such module '(\w+)'/i, title: "Module not found", cause: "Opened the .xcodeproj instead of the .xcworkspace, pods not installed, or a stale DerivedData.", fix: "Open the .xcworkspace, run pod install, then Product → Clean Build Folder (or rm -rf ~/Library/Developer/Xcode/DerivedData)." },
    { id: "arm64-sim", platform: "iOS / Xcode", re: /building for iOS Simulator, but linking in object file built for iOS|building for 'iOS-simulator', but linking in/i, title: "Simulator architecture mismatch", cause: "A prebuilt binary does not include an arm64 simulator slice (old fat frameworks) or EXCLUDED_ARCHS is set.", fix: "Update the dependency to an XCFramework. Remove EXCLUDED_ARCHS[sdk=iphonesimulator*]=arm64 hacks. As a last resort run the simulator under Rosetta." },
    { id: "ats", platform: "iOS / device", re: /App Transport Security has blocked a cleartext HTTP|NSURLErrorDomain Code=-1022/i, title: "HTTP blocked by App Transport Security", cause: "iOS blocks plain http:// by default.", fix: "Use https, or add NSAllowsLocalNetworking / an exception domain for development only." },
    { id: "privacy-manifest", platform: "iOS / App Store", re: /ITMS-91053|Missing API declaration|privacy manifest|ITMS-91061/i, title: "Privacy manifest required", cause: "Apps and SDKs using required-reason APIs (UserDefaults, file timestamps, disk space, system boot time) must declare them in PrivacyInfo.xcprivacy.", fix: "Add PrivacyInfo.xcprivacy to the app with NSPrivacyAccessedAPITypes and reasons, and update SDKs to versions that ship their own manifests (React Native 0.73.6+, current Flutter plugins)." },
    { id: "itms-90683", platform: "iOS / App Store", re: /ITMS-90683|Missing purpose string in Info\.plist/i, title: "Missing usage description", cause: "The binary references a protected API (camera, photos, location…) without the matching NS…UsageDescription.", fix: "Add the key named in the email to Info.plist (see the App Permissions tool), even if a dependency - not your code - uses the API. Flutter: disable unused permissions in the Podfile macros." },
    // React Native / Expo / Metro
    { id: "metro-resolve", platform: "React Native / Metro", re: /Unable to resolve module ([@\w/.-]+)/i, title: "Metro cannot find a module", cause: "Package not installed, a wrong import path, or a stale Metro cache.", fix: "npm install the package, check the path's case, then restart with a clean cache: npx react-native start --reset-cache (Expo: npx expo start -c)." },
    { id: "native-module", platform: "React Native / Metro", re: /requireNativeComponent|Invariant Violation: Native module cannot be null|TurboModuleRegistry\.getEnforcing\(\.\.\.\): '(\w+)' could not be found|The package '[^']+' doesn't seem to be linked/i, title: "Native module not linked", cause: "A package with native code was added but the app was not rebuilt, or it is unavailable in Expo Go.", fix: "Rebuild the native app: cd ios && pod install, then npx react-native run-ios / run-android. Expo: use a development build (npx expo run:ios / eas build --profile development) instead of Expo Go." },
    { id: "rn-version-mismatch", platform: "React Native / Metro", re: /React Native version mismatch|JavaScript version: [\d.]+.*Native version: [\d.]+/is, title: "JS and native React Native versions differ", cause: "The running native app was built from another React Native version than the JS bundle.", fix: "Rebuild the native app after upgrading, kill other Metro instances (lsof -i :8081) and clear caches." },
    { id: "hermes-mismatch", platform: "React Native / Metro", re: /Compiling JS failed|Hermes.*bytecode version/i, title: "Hermes bytecode mismatch", cause: "The bundle was compiled by another Hermes version than the app ships.", fix: "Clean and rebuild: cd android && ./gradlew clean; rm -rf ios/build; reinstall pods." },
    { id: "eas-credentials", platform: "Expo / EAS", re: /Distribution certificate.*(not found|invalid)|Failed to set up credentials/i, title: "EAS credentials problem", cause: "EAS cannot find or validate signing credentials.", fix: "Run eas credentials to inspect and regenerate them, or let EAS manage credentials for the build profile." },
    // Flutter
    { id: "flutter-gradle", platform: "Flutter", re: /Gradle task assembleDebug failed with exit code 1|Execution failed for task ':app:compileFlutterBuildDebug'/i, title: "Flutter Android build failed", cause: "The real error is earlier in the log (usually Kotlin/AGP/JDK versions or a plugin).", fix: "Scroll up to the first \"What went wrong\" or error: line; run cd android && ./gradlew assembleDebug --stacktrace for details; flutter clean && flutter pub get; run flutter doctor -v." },
    { id: "flutter-sdk", platform: "Flutter", re: /The current Dart SDK version is ([\d.]+)\.\s+Because \w+ requires SDK version ([^,]+)/i, title: "Dart SDK too old for a package", cause: "A package needs a newer Dart (and so Flutter) version.", fix: "flutter upgrade (or switch channels / use FVM), or pin an older package version in pubspec.yaml." },
    { id: "pub-solve", platform: "Flutter", re: /version solving failed/i, title: "pub version conflict", cause: "Two packages need incompatible versions of a shared dependency.", fix: "Run flutter pub outdated, upgrade the conflicting packages together (flutter pub upgrade --major-versions), or add a temporary dependency_overrides entry." },
    { id: "flutter-kotlin", platform: "Flutter", re: /Your project requires a newer version of the Kotlin Gradle plugin|Flutter support for your project's (Android Gradle Plugin|Kotlin|Gradle) version .* will soon be dropped/i, title: "Kotlin / AGP / Gradle too old for Flutter", cause: "Flutter requires minimum toolchain versions in android/settings.gradle and gradle-wrapper.properties.", fix: "In android/settings.gradle(.kts) raise com.android.application and org.jetbrains.kotlin.android versions, and update gradle-wrapper.properties; check the SDK & Build Compatibility tool for matching versions." },
    { id: "cocoapods-flutter", platform: "Flutter", re: /CocoaPods' specs repository is too out-of-date|Error running pod install/i, title: "Flutter iOS pod install failed", cause: "Stale CocoaPods specs or a deployment target conflict.", fix: "cd ios && pod repo update && pod install; or rm -rf ios/Pods ios/Podfile.lock && flutter clean && flutter pub get && cd ios && pod install." },
    // Web / Node
    { id: "eresolve", platform: "Node / npm", re: /ERESOLVE (unable to resolve dependency tree|could not resolve)/i, title: "npm peer dependency conflict", cause: "npm 7+ enforces peer dependencies; a package declares a peer range your versions do not satisfy.", fix: "Upgrade the package that has the stale peer range, or align versions. As a temporary workaround: npm install --legacy-peer-deps (and record why), or add an overrides entry in package.json." },
    { id: "ossl", platform: "Node / npm", re: /ERR_OSSL_EVP_UNSUPPORTED|digital envelope routines::unsupported/i, title: "Old webpack on Node 17+", cause: "webpack 4 / old react-scripts use MD4 hashing that OpenSSL 3 disabled.", fix: "Upgrade to webpack 5 / Vite / Next.js; temporary: NODE_OPTIONS=--openssl-legacy-provider." },
    { id: "eaddrinuse", platform: "Node / npm", re: /EADDRINUSE.*:(\d+)/i, title: "Port already in use", cause: "Another process (often a previous dev server) is listening on the port.", fix: "macOS/Linux: lsof -nP -iTCP:<port> -sTCP:LISTEN, then kill <pid>; Windows: netstat -ano | findstr :<port> then taskkill /PID <pid> /F. Or use another port." },
    { id: "enospc", platform: "Node / npm", re: /ENOSPC: System limit for number of file watchers reached|EMFILE: too many open files/i, title: "File watcher limit reached", cause: "The OS limit on watched files is too low for the project.", fix: "Linux: echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p. macOS: brew install watchman (Metro / Jest use it)." },
    { id: "esm-require", platform: "Node / npm", re: /ERR_REQUIRE_ESM|require\(\) of ES Module|Cannot use import statement outside a module/i, title: "CommonJS / ES module mismatch", cause: "Mixing require() with an ESM-only package, or import syntax in a CommonJS file.", fix: "Use import (set \"type\": \"module\" or .mjs), or a dynamic await import(). Node 22.12+ can require() ESM. For TypeScript set module/moduleResolution to NodeNext. Jest: transform the package or use Vitest." },
    { id: "module-not-found-fs", platform: "Next.js / bundlers", re: /Module not found: (Error: )?Can't resolve '(fs|path|crypto|net|tls|child_process)'/i, title: "Node built-in imported in browser code", cause: "Server-only code (fs, database clients) is imported by a client component or browser bundle.", fix: "Move it to server code (route handler, server action, getServerSideProps) or add import \"server-only\"; only import browser-safe modules from \"use client\" files." },
    { id: "hydration", platform: "Next.js / React", re: /Hydration failed|Text content does not match server-rendered HTML|did not match\. Server:/i, title: "Hydration mismatch", cause: "Server HTML differs from the first client render: Date.now()/Math.random(), window/localStorage reads during render, locale formatting, or invalid nesting (<div> inside <p>).", fix: "Render client-only values in useEffect or with dynamic(() => …, { ssr: false }), fix invalid HTML nesting, and check browser extensions that modify the DOM. suppressHydrationWarning only for unavoidable cases like timestamps." },
    { id: "server-client", platform: "Next.js / React", re: /You're importing a component that needs (useState|useEffect|\w+)\. (It only works in a Client Component|This React hook only works)/i, title: "Hook used in a Server Component", cause: "App Router components are Server Components by default; hooks and event handlers need a Client Component.", fix: "Add \"use client\" at the top of the file that uses the hook (keep it as low in the tree as possible)." },
    { id: "invalid-hook", platform: "Next.js / React", re: /Invalid hook call/i, title: "Invalid hook call", cause: "A hook called outside a component, conditionally, or two copies of React are installed (common in monorepos and linked packages).", fix: "Call hooks at the top level of components; run npm ls react to find duplicates and dedupe (npm dedupe, or resolve.alias / peerDependencies)." },
    { id: "cors", platform: "Browser", re: /blocked by CORS policy|Access-Control-Allow-Origin/i, title: "CORS error", cause: "The API did not allow this page's origin.", fix: "Configure CORS on the server (see the CORS Builder & Debugger tool). Native mobile HTTP clients are not affected by CORS." },
    { id: "ts-cannot-find", platform: "TypeScript", re: /TS2307: Cannot find module '([^']+)'|Could not find a declaration file for module '([^']+)'/i, title: "TypeScript cannot find a module or its types", cause: "Missing package, missing @types, or path aliases not configured.", fix: "npm install the package and its @types/ package if it has no built-in types; check paths/baseUrl in tsconfig.json and the bundler alias; restart the TS server." },
    { id: "docker-platform", platform: "Docker", re: /exec format error|requested image's platform \(linux\/amd64\) does not match/i, title: "Image built for another CPU architecture", cause: "An amd64 image on an ARM machine (Apple Silicon, Graviton) or the reverse.", fix: "Build multi-arch images: docker buildx build --platform linux/amd64,linux/arm64 …, or set platform: linux/amd64 in compose for local use." }
];
function explainBuildLog(log) {
    const lines = log.split(/\r?\n/);
    const found = [];
    for (const error of exports.KNOWN_ERRORS) {
        for (let i = 0; i < lines.length; i++) {
            const m = error.re.exec(lines[i]);
            if (m) {
                found.push({ error, line: lines[i].trim().slice(0, 240), lineNo: i + 1, match: m });
                break;
            }
        }
        if (!found.some(f => f.error === error)) {
            const m = error.re.exec(log);
            if (m) {
                const lineNo = log.slice(0, m.index).split(/\r?\n/).length;
                found.push({ error, line: lines[lineNo - 1]?.trim().slice(0, 240) ?? "", lineNo, match: m });
            }
        }
    }
    return found.sort((a, b) => a.lineNo - b.lineNo);
}
exports.explainBuildLog = explainBuildLog;
function firstErrorLines(log, max = 5) {
    return log.split(/\r?\n/).map(l => l.trim()).filter(l => /(^error\b|\berror:|^E\/|FAILURE:|What went wrong|^✗|Exception|fatal:|failed)/i.test(l) && !/^\s*at /.test(l)).slice(0, max);
}
exports.firstErrorLines = firstErrorLines;
// ---------------------------------------------------------------------------
// Versions and compatibility
// ---------------------------------------------------------------------------
exports.ANDROID_LEVELS = [
    [36, "16", "Baklava", 2025, "Large screens ignore orientation/resizability limits on targetSdk 36; predictive back on by default; 16 KB pages required on Play for targetSdk 35+ updates"],
    [35, "15", "Vanilla Ice Cream", 2024, "Edge-to-edge enforced for targetSdk 35; 16 KB page size support; foreground service timeouts"],
    [34, "14", "Upside Down Cake", 2023, "Foreground service types required; partial photo access; minimum installable targetSdk 23; implicit intents must be explicit for internal components"],
    [33, "13", "Tiramisu", 2022, "POST_NOTIFICATIONS runtime permission; granular media permissions (READ_MEDIA_*); per-app languages; photo picker"],
    [32, "12L", "Sv2", 2022, "Large-screen improvements"],
    [31, "12", "Snow Cone", 2021, "android:exported required; PendingIntent mutability flags; approximate location; splash screen API; exact alarm permission; Bluetooth permissions"],
    [30, "11", "Red Velvet Cake", 2020, "Package visibility (<queries>); scoped storage enforced; one-time permissions"],
    [29, "10", "Quince Tart", 2019, "Scoped storage; ACCESS_BACKGROUND_LOCATION; dark theme"],
    [28, "9", "Pie", 2018, "Cleartext HTTP blocked by default; display cutouts"],
    [26, "8.0", "Oreo", 2017, "Notification channels; background execution limits; adaptive icons"],
    [24, "7.0", "Nougat", 2016, "Multi-window; FileProvider required for file:// URIs (24+). React Native 0.76+ minSdk"],
    [23, "6.0", "Marshmallow", 2015, "Runtime permissions; App Links (autoVerify)"],
    [21, "5.0", "Lollipop", 2014, "Material design; ART; Flutter's historical minSdk"]
];
exports.AGP_MATRIX = [
    { agp: "9.0", gradle: "9.1.0", jdk: 17, maxApi: 36 },
    { agp: "8.13", gradle: "8.13", jdk: 17, maxApi: 36 },
    { agp: "8.12", gradle: "8.13", jdk: 17, maxApi: 36 },
    { agp: "8.11", gradle: "8.13", jdk: 17, maxApi: 36 },
    { agp: "8.10", gradle: "8.11.1", jdk: 17, maxApi: 36 },
    { agp: "8.9", gradle: "8.11.1", jdk: 17, maxApi: 36 },
    { agp: "8.8", gradle: "8.10.2", jdk: 17, maxApi: 35 },
    { agp: "8.7", gradle: "8.9", jdk: 17, maxApi: 35 },
    { agp: "8.6", gradle: "8.7", jdk: 17, maxApi: 35 },
    { agp: "8.5", gradle: "8.7", jdk: 17, maxApi: 34 },
    { agp: "8.4", gradle: "8.6", jdk: 17, maxApi: 34 },
    { agp: "8.3", gradle: "8.4", jdk: 17, maxApi: 34 },
    { agp: "8.2", gradle: "8.2", jdk: 17, maxApi: 34 },
    { agp: "8.1", gradle: "8.0", jdk: 17, maxApi: 34 },
    { agp: "8.0", gradle: "8.0", jdk: 17, maxApi: 33 },
    { agp: "7.4", gradle: "7.5", jdk: 11, maxApi: 33 },
    { agp: "7.3", gradle: "7.4", jdk: 11, maxApi: 33 },
    { agp: "7.2", gradle: "7.3.3", jdk: 11, maxApi: 32 },
    { agp: "7.1", gradle: "7.2", jdk: 11, maxApi: 32 },
    { agp: "7.0", gradle: "7.0", jdk: 11, maxApi: 31 }
];
/** Highest Java version each Gradle release can run on. */
exports.GRADLE_MAX_JDK = [["9.1", 25], ["8.14", 24], ["8.10", 23], ["8.8", 22], ["8.5", 21], ["8.3", 20], ["7.6", 19], ["7.5", 18], ["7.3", 17], ["7.0", 16], ["6.7", 15]];
exports.XCODE_MATRIX = [
    ["Xcode 26", "iOS 26", "Swift 6.2", "macOS 15.6+", "2025 - Liquid Glass design; required for App Store uploads from spring 2026 (check Apple's announced date)"],
    ["Xcode 16.4", "iOS 18.5", "Swift 6.1", "macOS 15.3+", "2025"],
    ["Xcode 16", "iOS 18", "Swift 6.0", "macOS 14.5+", "2024 - required for App Store uploads since 24 Apr 2025"],
    ["Xcode 15", "iOS 17", "Swift 5.9", "macOS 13.5+", "2023 - privacy manifests; user script sandboxing on by default"],
    ["Xcode 14", "iOS 16", "Swift 5.7", "macOS 12.5+", "2022 - single 1024 px app icon"]
];
exports.FLUTTER_MATRIX = [
    ["3.38", "3.10", "Nov 2025"], ["3.35", "3.9", "Aug 2025"], ["3.32", "3.8", "May 2025"], ["3.29", "3.7", "Feb 2025"], ["3.27", "3.6", "Dec 2024"], ["3.24", "3.5", "Aug 2024"], ["3.22", "3.4", "May 2024"], ["3.19", "3.3", "Feb 2024"], ["3.16", "3.2", "Nov 2023"], ["3.13", "3.1", "Aug 2023"], ["3.10", "3.0", "May 2023 - null safety required"]
];
exports.RN_MATRIX = [
    ["0.83", "19.2", "SDK 55", "Dec 2025"],
    ["0.82", "19.1", "-", "Oct 2025 - New Architecture only (legacy architecture removed)"],
    ["0.81", "19.1", "SDK 54", "Aug 2025 - Android 16 / edge-to-edge; Node 20.19.4+; Xcode 16.1+"],
    ["0.80", "19.1", "-", "Jun 2025 - legacy architecture frozen; deep imports deprecated"],
    ["0.79", "19.0", "SDK 53", "Apr 2025 - faster Metro startup; JSC moved to community package"],
    ["0.78", "19.0", "-", "Feb 2025 - React 19"],
    ["0.77", "18.3", "-", "Jan 2025 - Swift AppDelegate template; 16 KB page support"],
    ["0.76", "18.3", "SDK 52", "Oct 2024 - New Architecture on by default; minSdk 24; iOS 15.1"],
    ["0.74", "18.2", "SDK 51", "Apr 2024 - Yoga 3; Bridgeless in new arch"],
    ["0.73", "18.2", "SDK 50", "Dec 2023 - Java 17 required; Node 18+"]
];
const vnum = (v) => v.split(".").map(Number);
function versionGte(a, b) {
    const x = vnum(a), y = vnum(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const p = x[i] ?? 0, q = y[i] ?? 0;
        if (p !== q)
            return p > q;
    }
    return true;
}
exports.versionGte = versionGte;
function detectVersions(text) {
    const d = {};
    const pick = (re) => re.exec(text)?.[1];
    d.gradle = pick(/gradle-([\d.]+)-(?:all|bin)\.zip/);
    d.agp = pick(/com\.android\.(?:application|library|tools\.build:gradle)["']?\)?\s*(?:version\s*)?[:"'(]*\s*["']?([\d.]+)/) ?? pick(/\bagp\s*=\s*["']([\d.]+)["']/i) ?? pick(/androidGradlePlugin\s*=\s*["']([\d.]+)["']/i) ?? pick(/com\.android\.tools\.build:gradle:([\d.]+)/);
    d.kotlin = pick(/org\.jetbrains\.kotlin(?:\.android|:kotlin-gradle-plugin)["']?\)?\s*(?:version\s*)?[:"'(]*\s*["']?([\d.]+)/) ?? pick(/\bkotlin(?:_version)?\s*=\s*["']([\d.]+)["']/i);
    const n = (re) => { const v = pick(re); return v ? Number(v) : undefined; };
    d.compileSdk = n(/compileSdk(?:Version)?\s*[=(]?\s*(\d+)/);
    d.targetSdk = n(/targetSdk(?:Version)?\s*[=(]?\s*(\d+)/);
    d.minSdk = n(/minSdk(?:Version)?\s*[=(]?\s*(\d+)/);
    d.jdk = n(/JavaVersion\.VERSION_(\d+)/) ?? n(/jvmTarget\s*=\s*["']?(\d+)/) ?? n(/JvmTarget\.JVM_(\d+)/);
    return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
}
exports.detectVersions = detectVersions;
function checkAndroidToolchain(v) {
    const out = [];
    const row = v.agp ? exports.AGP_MATRIX.find(r => versionGte(v.agp, r.agp)) : undefined;
    if (v.agp && !row)
        out.push({ severity: "warning", text: `AGP ${v.agp} is older than 7.0; upgrade with the AGP Upgrade Assistant in Android Studio.` });
    if (row) {
        out.push({ severity: "info", text: `AGP ${v.agp} needs Gradle ${row.gradle}+ and JDK ${row.jdk}+, and supports compileSdk up to ${row.maxApi}.` });
        if (v.gradle)
            out.push(versionGte(v.gradle, row.gradle) ? { severity: "success", text: `Gradle ${v.gradle} is new enough for AGP ${v.agp}.` } : { severity: "error", text: `Gradle ${v.gradle} is too old for AGP ${v.agp}: set distributionUrl to gradle-${row.gradle}-bin.zip (or newer).` });
        if (v.compileSdk && v.compileSdk > row.maxApi)
            out.push({ severity: "warning", text: `compileSdk ${v.compileSdk} is newer than AGP ${v.agp} was tested with (${row.maxApi}); upgrade AGP to avoid build warnings or failures.` });
        if (v.runtimeJdk && v.runtimeJdk < row.jdk)
            out.push({ severity: "error", text: `JDK ${v.runtimeJdk} cannot run AGP ${v.agp}; it needs JDK ${row.jdk}.` });
    }
    if (v.gradle && v.runtimeJdk) {
        const max = exports.GRADLE_MAX_JDK.find(([g]) => versionGte(v.gradle, g))?.[1];
        if (max && v.runtimeJdk > max)
            out.push({ severity: "error", text: `Gradle ${v.gradle} cannot run on JDK ${v.runtimeJdk} (max ${max}). Use JDK ${Math.min(max, 17)} or upgrade Gradle - this is the "Unsupported class file major version" error.` });
    }
    if (v.targetSdk !== undefined) {
        if (v.targetSdk < 35)
            out.push({ severity: "error", text: `targetSdk ${v.targetSdk}: Google Play requires new apps and updates to target API 35 (Android 15) since 31 Aug 2025, and usually raises the bar to the next level each August.` });
        else
            out.push({ severity: "success", text: `targetSdk ${v.targetSdk} meets Google Play's 2025 target API requirement (35); plan for 36 when Google announces the next deadline.` });
    }
    if (v.compileSdk !== undefined && v.targetSdk !== undefined && v.compileSdk < v.targetSdk)
        out.push({ severity: "error", text: "compileSdk must be at least targetSdk." });
    if (v.minSdk !== undefined) {
        if (v.minSdk < 21)
            out.push({ severity: "warning", text: `minSdk ${v.minSdk}: most current libraries need 21+ (React Native 0.76+ needs 24, many Jetpack libraries 21-23).` });
        else
            out.push({ severity: "info", text: `minSdk ${v.minSdk} = Android ${exports.ANDROID_LEVELS.find(l => l[0] <= v.minSdk)?.[1] ?? "?"}.` });
    }
    if (v.kotlin && versionGte(v.kotlin, "2.0"))
        out.push({ severity: "info", text: `Kotlin ${v.kotlin}: Jetpack Compose needs the org.jetbrains.kotlin.plugin.compose plugin with the same version.` });
    if (v.kotlin && !versionGte(v.kotlin, "1.9"))
        out.push({ severity: "warning", text: `Kotlin ${v.kotlin} is old; current AndroidX and Flutter/RN tooling expect 1.9+ (2.x recommended).` });
    if (!out.length)
        out.push({ severity: "info", text: "Paste build.gradle(.kts), settings.gradle(.kts), libs.versions.toml and gradle-wrapper.properties - or fill in the versions - to check them." });
    return out;
}
exports.checkAndroidToolchain = checkAndroidToolchain;
function mobileCi(o) {
    const install = o.packageManager === "pnpm" ? "pnpm install --frozen-lockfile" : o.packageManager === "yarn" ? "yarn install --immutable" : "npm ci";
    const run = (s) => (o.packageManager === "npm" ? `npm run ${s}` : `${o.packageManager} ${s}`);
    const checkout = { uses: "actions/checkout@v4" };
    const java = { uses: "actions/setup-java@v4", with: { distribution: "temurin", "java-version": o.java } };
    const gradle = { uses: "gradle/actions/setup-gradle@v4" };
    const node = [...(o.packageManager === "pnpm" ? [{ uses: "pnpm/action-setup@v4" }] : []), { uses: "actions/setup-node@v4", with: { "node-version": o.node, cache: o.packageManager } }, { run: install }];
    const decodeKeystore = { name: "Decode Android keystore", run: 'echo "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$RUNNER_TEMP/upload.jks"\necho "ANDROID_KEYSTORE_PATH=$RUNNER_TEMP/upload.jks" >> "$GITHUB_ENV"\n', env: { ANDROID_KEYSTORE_BASE64: "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" } };
    const signingEnv = { ANDROID_KEYSTORE_PASSWORD: "${{ secrets.ANDROID_KEYSTORE_PASSWORD }}", ANDROID_KEY_ALIAS: "${{ secrets.ANDROID_KEY_ALIAS }}", ANDROID_KEY_PASSWORD: "${{ secrets.ANDROID_KEY_PASSWORD }}" };
    const playUpload = (file) => ({ name: "Upload to Google Play (internal track)", uses: "r0adkll/upload-google-play@v1", with: { serviceAccountJsonPlainText: "${{ secrets.PLAY_SERVICE_ACCOUNT_JSON }}", packageName: "com.example.app", releaseFiles: file, track: "internal", status: "completed" } });
    const iosSigning = [
        { name: "Install signing certificate and profile", uses: "apple-actions/import-codesign-certs@v3", with: { "p12-file-base64": "${{ secrets.IOS_CERTIFICATE_P12_BASE64 }}", "p12-password": "${{ secrets.IOS_CERTIFICATE_PASSWORD }}" } },
        { name: "Download provisioning profiles", uses: "apple-actions/download-provisioning-profiles@v4", with: { "bundle-id": "com.example.app", "issuer-id": "${{ secrets.APPSTORE_ISSUER_ID }}", "api-key-id": "${{ secrets.APPSTORE_KEY_ID }}", "api-private-key": "${{ secrets.APPSTORE_PRIVATE_KEY }}" } }
    ];
    const testflight = (ipa) => ({ name: "Upload to TestFlight", uses: "apple-actions/upload-testflight-build@v3", with: { "app-path": ipa, "issuer-id": "${{ secrets.APPSTORE_ISSUER_ID }}", "api-key-id": "${{ secrets.APPSTORE_KEY_ID }}", "api-private-key": "${{ secrets.APPSTORE_PRIVATE_KEY }}" } });
    const artifact = (name, path) => ({ uses: "actions/upload-artifact@v4", with: { name, path, "retention-days": 14 } });
    const secrets = [];
    const androidSecrets = () => secrets.push(["ANDROID_KEYSTORE_BASE64", "base64 of the upload keystore (.jks)"], ["ANDROID_KEYSTORE_PASSWORD", "Keystore password"], ["ANDROID_KEY_ALIAS", "Key alias"], ["ANDROID_KEY_PASSWORD", "Key password"]);
    const iosSecrets = () => secrets.push(["IOS_CERTIFICATE_P12_BASE64", "base64 of the distribution certificate .p12"], ["IOS_CERTIFICATE_PASSWORD", ".p12 export password"], ["APPSTORE_ISSUER_ID", "App Store Connect API issuer ID"], ["APPSTORE_KEY_ID", "App Store Connect API key ID"], ["APPSTORE_PRIVATE_KEY", "Contents of the AuthKey_XXXX.p8 file"]);
    const jobs = {};
    const releaseIf = `github.event_name == 'push' && github.ref == 'refs/heads/${o.branch}'`;
    switch (o.stack) {
        case "flutter": {
            const flutter = { uses: "subosito/flutter-action@v2", with: { "flutter-version": o.flutter, channel: "stable", cache: true } };
            jobs.test = { "runs-on": "ubuntu-latest", "timeout-minutes": 20, steps: [checkout, flutter, { run: "flutter pub get" }, { run: "dart format --output=none --set-exit-if-changed ." }, { run: "flutter analyze" }, ...(o.tests ? [{ run: "flutter test --coverage" }] : [])] };
            if (o.release) {
                androidSecrets();
                jobs.android = { needs: "test", if: releaseIf, "runs-on": "ubuntu-latest", "timeout-minutes": 30, steps: [checkout, java, flutter, { run: "flutter pub get" }, decodeKeystore, { name: "Build app bundle", run: "flutter build appbundle --release --build-number=${{ github.run_number }}", env: signingEnv }, artifact("android-aab", "build/app/outputs/bundle/release/*.aab"), ...(o.deploy ? [playUpload("build/app/outputs/bundle/release/app-release.aab")] : [])] };
                iosSecrets();
                jobs.ios = { needs: "test", if: releaseIf, "runs-on": "macos-15", "timeout-minutes": 45, steps: [checkout, flutter, { run: "flutter pub get" }, ...iosSigning, { name: "Build IPA", run: "flutter build ipa --release --build-number=${{ github.run_number }} --export-options-plist=ios/ExportOptions.plist" }, artifact("ios-ipa", "build/ios/ipa/*.ipa"), ...(o.deploy ? [testflight("build/ios/ipa/*.ipa")] : [])] };
            }
            break;
        }
        case "android": {
            jobs.test = { "runs-on": "ubuntu-latest", "timeout-minutes": 30, steps: [checkout, java, gradle, { run: `./gradlew lint${o.tests ? " testDebugUnitTest" : ""}` }, ...(o.tests ? [{ if: "failure()", ...artifact("test-reports", "**/build/reports/") }] : [])] };
            if (o.release) {
                androidSecrets();
                jobs.release = { needs: "test", if: releaseIf, "runs-on": "ubuntu-latest", "timeout-minutes": 30, steps: [checkout, java, gradle, decodeKeystore, { name: "Build release bundle", run: "./gradlew bundleRelease", env: signingEnv }, artifact("app-release", "app/build/outputs/bundle/release/*.aab"), ...(o.deploy ? [playUpload("app/build/outputs/bundle/release/app-release.aab")] : [])] };
            }
            break;
        }
        case "ios": {
            const scheme = o.scheme || "App";
            jobs.test = { "runs-on": "macos-15", "timeout-minutes": 40, steps: [checkout, { uses: "maxim-lobanov/setup-xcode@v1", with: { "xcode-version": "latest-stable" } }, ...(o.tests ? [{ name: "Test", run: `set -o pipefail\nxcodebuild test -scheme "${scheme}" -destination "platform=iOS Simulator,name=iPhone 16" -resultBundlePath TestResults | xcbeautify` }] : [{ run: `xcodebuild build -scheme "${scheme}" -destination "generic/platform=iOS Simulator" CODE_SIGNING_ALLOWED=NO` }])] };
            if (o.release) {
                iosSecrets();
                jobs.release = { needs: "test", if: releaseIf, "runs-on": "macos-15", "timeout-minutes": 45, steps: [checkout, { uses: "maxim-lobanov/setup-xcode@v1", with: { "xcode-version": "latest-stable" } }, ...iosSigning, { name: "Archive", run: `xcodebuild archive -scheme "${scheme}" -configuration Release -archivePath "$RUNNER_TEMP/App.xcarchive" -destination "generic/platform=iOS" CURRENT_PROJECT_VERSION=\${{ github.run_number }}` }, { name: "Export IPA", run: 'xcodebuild -exportArchive -archivePath "$RUNNER_TEMP/App.xcarchive" -exportOptionsPlist ExportOptions.plist -exportPath "$RUNNER_TEMP/export"' }, artifact("ios-ipa", "${{ runner.temp }}/export/*.ipa"), ...(o.deploy ? [testflight("${{ runner.temp }}/export/*.ipa")] : [])] };
            }
            break;
        }
        case "react-native": {
            jobs.test = { "runs-on": "ubuntu-latest", "timeout-minutes": 20, steps: [checkout, ...node, { run: run("lint") }, { run: "npx tsc --noEmit" }, ...(o.tests ? [{ run: `${run("test")} -- --ci` }] : [])] };
            if (o.release) {
                androidSecrets();
                jobs.android = { needs: "test", if: releaseIf, "runs-on": "ubuntu-latest", "timeout-minutes": 40, steps: [checkout, ...node, java, gradle, decodeKeystore, { name: "Build release bundle", "working-directory": "android", run: "./gradlew bundleRelease", env: signingEnv }, artifact("android-aab", "android/app/build/outputs/bundle/release/*.aab"), ...(o.deploy ? [playUpload("android/app/build/outputs/bundle/release/app-release.aab")] : [])] };
                iosSecrets();
                jobs.ios = { needs: "test", if: releaseIf, "runs-on": "macos-15", "timeout-minutes": 60, steps: [checkout, ...node, { uses: "ruby/setup-ruby@v1", with: { "ruby-version": "3.3", "bundler-cache": true } }, { name: "Install pods", "working-directory": "ios", run: "bundle exec pod install" }, ...iosSigning, { name: "Archive", "working-directory": "ios", run: `xcodebuild archive -workspace "${o.scheme || "App"}.xcworkspace" -scheme "${o.scheme || "App"}" -configuration Release -archivePath "$RUNNER_TEMP/App.xcarchive" -destination "generic/platform=iOS"` }, { name: "Export IPA", "working-directory": "ios", run: 'xcodebuild -exportArchive -archivePath "$RUNNER_TEMP/App.xcarchive" -exportOptionsPlist ExportOptions.plist -exportPath "$RUNNER_TEMP/export"' }, ...(o.deploy ? [testflight("${{ runner.temp }}/export/*.ipa")] : [])] };
            }
            break;
        }
        case "expo": {
            jobs.test = { "runs-on": "ubuntu-latest", "timeout-minutes": 20, steps: [checkout, ...node, { run: "npx expo lint" }, { run: "npx tsc --noEmit" }, { run: "npx expo-doctor" }, ...(o.tests ? [{ run: `${run("test")} -- --ci` }] : [])] };
            secrets.push(["EXPO_TOKEN", "Expo access token (expo.dev → Account settings → Access tokens)"]);
            jobs.update = { needs: "test", if: "github.event_name == 'pull_request'", "runs-on": "ubuntu-latest", steps: [checkout, ...node, { uses: "expo/expo-github-action@v8", with: { "eas-version": "latest", token: "${{ secrets.EXPO_TOKEN }}" } }, { name: "Publish a preview update for this PR", run: "eas update --auto --branch pr-${{ github.event.number }} --non-interactive" }] };
            if (o.release)
                jobs.build = { needs: "test", if: releaseIf, "runs-on": "ubuntu-latest", steps: [checkout, ...node, { uses: "expo/expo-github-action@v8", with: { "eas-version": "latest", token: "${{ secrets.EXPO_TOKEN }}" } }, { name: "Build on EAS", run: `eas build --platform all --profile production --non-interactive --no-wait${o.deploy ? " --auto-submit" : ""}` }] };
            break;
        }
    }
    const workflow = {
        name: `Mobile CI (${o.stack})`,
        on: { push: { branches: [o.branch] }, pull_request: {}, workflow_dispatch: {} },
        concurrency: { group: "${{ github.workflow }}-${{ github.ref }}", "cancel-in-progress": true },
        permissions: { contents: "read" },
        jobs
    };
    const files = [{ path: ".github/workflows/mobile.yml", language: "yaml", content: yaml_1.default.stringify(workflow, { lineWidth: 0, aliasDuplicateObjects: false }) }];
    if (o.release && (o.stack === "ios" || o.stack === "flutter" || o.stack === "react-native"))
        files.push({ path: o.stack === "flutter" ? "ios/ExportOptions.plist" : o.stack === "react-native" ? "ios/ExportOptions.plist" : "ExportOptions.plist", language: "xml", content: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n    <key>method</key>\n    <string>app-store-connect</string>\n    <key>teamID</key>\n    <string>TEAMID1234</string>\n    <key>signingStyle</key>\n    <string>manual</string>\n    <key>provisioningProfiles</key>\n    <dict>\n        <key>com.example.app</key>\n        <string>com.example.app AppStore</string>\n    </dict>\n    <key>uploadSymbols</key>\n    <true/>\n</dict>\n</plist>\n` });
    if (o.deploy && ["flutter", "android", "react-native"].includes(o.stack))
        secrets.push(["PLAY_SERVICE_ACCOUNT_JSON", "Google Cloud service account JSON with release access in Play Console (Users and permissions)"]);
    return { files, secrets };
}
exports.mobileCi = mobileCi;
//# sourceMappingURL=mobile-build.js.map