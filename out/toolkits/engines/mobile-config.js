"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ASSET_SIZES = exports.densityTable = exports.ANDROID_DENSITIES = exports.shades = exports.contrastRatio = exports.relativeLuminance = exports.colorFormats = exports.rgbToHsl = exports.parseColor = exports.localApiAccess = exports.deviceCommands = exports.flavorFiles = exports.parseEnvironments = exports.permissionFiles = exports.PERMISSIONS = exports.deepLinkFiles = exports.pathMatches = exports.normalizeFingerprint = void 0;
const types_1 = require("../types");
const xmlEsc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function normalizeFingerprint(fp) {
    const hex = fp.replace(/^SHA-?256:?\s*/i, "").replace(/[\s:]/g, "").toUpperCase();
    if (/^[0-9A-F]{64}$/.test(hex))
        return hex.match(/../g).join(":");
    if (/^[A-Za-z0-9+/_-]{43}=?$/.test(fp.trim())) {
        const buf = Buffer.from(fp.trim().replace(/-/g, "+").replace(/_/g, "/"), "base64");
        if (buf.length === 32)
            return buf.toString("hex").toUpperCase().match(/../g).join(":");
    }
    return undefined;
}
exports.normalizeFingerprint = normalizeFingerprint;
/** "/products/:id" → "/products/*" for AASA; "!" prefix excludes. */
function aasaPath(p) {
    const exclude = p.startsWith("!");
    const path = (exclude ? p.slice(1) : p).replace(/:[A-Za-z_]\w*/g, "*").replace(/\/\*\*$/, "/*");
    return exclude ? { "/": path, exclude: true } : { "/": path };
}
function androidPathAttr(p) {
    const path = p.replace(/:[A-Za-z_]\w*/g, "*");
    if (path === "/*" || path === "*")
        return 'android:pathPrefix="/"';
    if (/^[^*]*\/\*$/.test(path))
        return `android:pathPrefix="${xmlEsc(path.slice(0, -1))}"`;
    if (!path.includes("*"))
        return `android:path="${xmlEsc(path)}"`;
    return `android:pathPattern="${xmlEsc(path.replace(/\./g, "\\\\.").replace(/\*/g, ".*"))}"`;
}
function pathMatches(pattern, path) {
    const p = pattern.replace(/^!/, "").replace(/:[A-Za-z_]\w*/g, "*");
    const re = new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
    return re.test(path) || (p.endsWith("/*") && path === p.slice(0, -2));
}
exports.pathMatches = pathMatches;
function deepLinkFiles(o) {
    const warnings = [];
    const domain = o.domain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain))
        throw new types_1.ToolInputError("Enter the website domain, e.g. example.com (no https://).");
    if (o.androidPackage && !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(o.androidPackage))
        warnings.push(`"${o.androidPackage}" is not a valid Android package name (e.g. com.example.app).`);
    if (o.teamId && !/^[A-Z0-9]{10}$/.test(o.teamId))
        warnings.push("An Apple Team ID is 10 upper-case letters and digits (Membership details in the Apple Developer portal).");
    if (o.bundleId && !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(o.bundleId))
        warnings.push(`"${o.bundleId}" is not a valid bundle identifier.`);
    const fps = o.fingerprints.map(f => ({ raw: f, norm: normalizeFingerprint(f) }));
    for (const f of fps)
        if (!f.norm)
            warnings.push(`"${f.raw.slice(0, 30)}" is not a SHA-256 fingerprint (32 bytes, e.g. 14:6D:E9:…). SHA-1 does not work for App Links.`);
    if (!fps.length && o.androidPackage)
        warnings.push("Add the SHA-256 fingerprint of every signing key: the debug key, your upload key and - when Play App Signing is on - the app signing key from Play Console → Setup → App integrity.");
    const paths = o.paths.length ? o.paths : ["/*"];
    const files = [];
    const appId = `${o.teamId || "TEAMID1234"}.${o.bundleId || "com.example.app"}`;
    files.push({ path: "public/.well-known/apple-app-site-association", language: "json", content: JSON.stringify({ applinks: { details: [{ appIDs: [appId], components: paths.map(aasaPath) }] }, webcredentials: { apps: [appId] } }, null, 2) + "\n" });
    files.push({ path: "public/.well-known/assetlinks.json", language: "json", content: JSON.stringify([{ relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"], target: { namespace: "android_app", package_name: o.androidPackage || "com.example.app", sha256_cert_fingerprints: fps.map(f => f.norm).filter(Boolean).length ? fps.map(f => f.norm).filter(Boolean) : ["AA:BB:...:FF"] } }], null, 2) + "\n" });
    const include = paths.filter(p => !p.startsWith("!"));
    const scheme = o.scheme.trim().replace(/:\/*$/, "");
    const androidXml = `<!-- android/app/src/main/AndroidManifest.xml, inside the launcher <activity> -->\n<intent-filter android:autoVerify="true">\n    <action android:name="android.intent.action.VIEW" />\n    <category android:name="android.intent.category.DEFAULT" />\n    <category android:name="android.intent.category.BROWSABLE" />\n    <data android:scheme="https" />\n    <data android:host="${xmlEsc(domain)}" />\n${include.map(p => `    <data ${androidPathAttr(p)} />`).join("\n")}\n</intent-filter>\n${scheme ? `\n<!-- Custom scheme (${scheme}://) - works without verification but any app can claim it -->\n<intent-filter>\n    <action android:name="android.intent.action.VIEW" />\n    <category android:name="android.intent.category.DEFAULT" />\n    <category android:name="android.intent.category.BROWSABLE" />\n    <data android:scheme="${xmlEsc(scheme)}" />\n</intent-filter>\n` : ""}`;
    if (paths.some(p => p.startsWith("!")))
        warnings.push("Android intent filters cannot exclude paths; excluded paths only apply on iOS. Handle them in the app (open the browser for those URLs).");
    const iosEntitlements = `<!-- ios/<App>/<App>.entitlements (or Xcode → Signing & Capabilities → Associated Domains) -->\n<key>com.apple.developer.associated-domains</key>\n<array>\n    <string>applinks:${xmlEsc(domain)}</string>\n    <string>webcredentials:${xmlEsc(domain)}</string>\n    <!-- While developing: applinks:${xmlEsc(domain)}?mode=developer (enable Associated Domains Development in Settings → Developer) -->\n</array>\n${scheme ? `\n<!-- Info.plist: custom URL scheme -->\n<key>CFBundleURLTypes</key>\n<array>\n    <dict>\n        <key>CFBundleURLName</key>\n        <string>${xmlEsc(o.bundleId || "com.example.app")}</string>\n        <key>CFBundleURLSchemes</key>\n        <array>\n            <string>${xmlEsc(scheme)}</string>\n        </array>\n    </dict>\n</array>\n` : ""}`;
    files.push({ path: "deeplinks/AndroidManifest-intent-filters.xml", language: "xml", content: androidXml });
    files.push({ path: "deeplinks/ios-entitlements.plist.xml", language: "xml", content: iosEntitlements });
    const screens = include.map(p => p.replace(/^\//, "").replace(/\/\*$/, "").replace(/\*/g, ":param")).filter(Boolean);
    if (o.framework === "expo") {
        files.push({ path: "deeplinks/app.json.snippet.json", language: "json", content: JSON.stringify({ expo: { scheme: scheme || "myapp", ios: { bundleIdentifier: o.bundleId || "com.example.app", associatedDomains: [`applinks:${domain}`] }, android: { package: o.androidPackage || "com.example.app", intentFilters: [{ action: "VIEW", autoVerify: true, data: include.map(p => ({ scheme: "https", host: domain, ...(p === "/*" ? {} : /\/\*$/.test(p) ? { pathPrefix: p.slice(0, -1).replace(/:[A-Za-z_]\w*/g, "") } : { path: p }) })), category: ["BROWSABLE", "DEFAULT"] }] } } }, null, 2) + "\n" });
        warnings.push("Expo Router maps URLs to files automatically (app/products/[id].tsx handles /products/123). Rebuild the native app after changing app.json (npx expo prebuild / eas build).");
    }
    else if (o.framework === "react-native") {
        files.push({ path: "src/navigation/linking.ts", language: "typescript", content: `import { LinkingOptions } from "@react-navigation/native";\n\nexport type RootStackParamList = {\n  Home: undefined;\n${screens.map(s => `  ${s.split("/")[0].replace(/[^A-Za-z0-9]/g, "").replace(/^./, c => c.toUpperCase()) || "Screen"}: ${/:param/.test(s) ? "{ param: string }" : "undefined"};`).filter((l, i, a) => a.indexOf(l) === i).join("\n")}\n};\n\n// Pass to <NavigationContainer linking={linking}>\nexport const linking: LinkingOptions<RootStackParamList> = {\n  prefixes: ["https://${domain}"${scheme ? `, "${scheme}://"` : ""}],\n  config: {\n    screens: {\n      Home: "",\n${screens.map(s => `      ${s.split("/")[0].replace(/[^A-Za-z0-9]/g, "").replace(/^./, c => c.toUpperCase()) || "Screen"}: ${JSON.stringify(s)},`).filter((l, i, a) => a.indexOf(l) === i).join("\n")}\n    },\n  },\n};\n` });
        warnings.push("iOS (bare React Native): forward links in AppDelegate - RCTLinkingManager application:openURL:options: and application:continueUserActivity:restorationHandler: - or links open the app without navigating.");
    }
    else if (o.framework === "flutter") {
        files.push({ path: "lib/router.dart", language: "dart", content: `import 'package:flutter/material.dart';\nimport 'package:go_router/go_router.dart';\n\n// Flutter handles incoming links with its built-in deep linking when a router is used.\nfinal router = GoRouter(\n  routes: [\n    GoRoute(path: '/', builder: (context, state) => const Placeholder()),\n${screens.map(s => `    GoRoute(\n      path: '/${s.replace(/:param/g, ":id")}',\n      builder: (context, state) => Text('${s} \${state.pathParameters}'),\n    ),`).join("\n")}\n  ],\n);\n` });
        warnings.push("Flutter: if another plugin (app_links, uni_links, Firebase Dynamic Links replacement) handles links, set FlutterDeepLinkingEnabled = NO in Info.plist and <meta-data android:name=\"flutter_deeplinking_enabled\" android:value=\"false\" /> so they do not compete.");
    }
    const testUrl = `https://${domain}${include[0] && include[0] !== "/*" ? include[0].replace(/\*/g, "123").replace(/:[A-Za-z_]\w*/g, "123") : "/"}`;
    const pkg = o.androidPackage || "com.example.app";
    const tests = [
        "# 1. The files must be served over HTTPS with no redirects:",
        `curl -sI https://${domain}/.well-known/apple-app-site-association   # 200, Content-Type: application/json`,
        `curl -s https://${domain}/.well-known/assetlinks.json`,
        "",
        "# 2. What Apple's CDN has cached (devices read this, not your server):",
        `curl -s https://app-site-association.cdn-apple.com/a/v1/${domain}`,
        "",
        "# 3. Google's verification of assetlinks.json:",
        `curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://${domain}&relation=delegate_permission/common.handle_all_urls"`,
        "",
        "# 4. Android: force re-verification and check the result (Android 12+)",
        `adb shell pm verify-app-links --re-verify ${pkg}`,
        `adb shell pm get-app-links ${pkg}   # expect: ${domain}: verified`,
        `adb shell am start -W -a android.intent.action.VIEW -d "${testUrl}" ${pkg}`,
        ...(scheme ? [`adb shell am start -W -a android.intent.action.VIEW -d "${scheme}://${include[0] && include[0] !== "/*" ? include[0].replace(/^\//, "").replace(/\*/g, "123").replace(/:[A-Za-z_]\w*/g, "123") : ""}" ${pkg}`] : []),
        "",
        "# 5. iOS simulator",
        `xcrun simctl openurl booted "${testUrl}"`,
        "# Universal links do not open when typed in Safari's address bar; tap them from Notes or Messages."
    ].join("\n");
    return { files, warnings, tests };
}
exports.deepLinkFiles = deepLinkFiles;
exports.PERMISSIONS = [
    { id: "camera", label: "Camera", ios: [["NSCameraUsageDescription", "$(PRODUCT_NAME) uses the camera to scan documents and take photos."]], android: [{ name: "android.permission.CAMERA" }], flutterMacro: "PERMISSION_CAMERA", rnp: "Camera" },
    { id: "microphone", label: "Microphone", ios: [["NSMicrophoneUsageDescription", "$(PRODUCT_NAME) uses the microphone to record audio and video."]], android: [{ name: "android.permission.RECORD_AUDIO" }], flutterMacro: "PERMISSION_MICROPHONE", rnp: "Microphone" },
    { id: "photos", label: "Photo library (read)", ios: [["NSPhotoLibraryUsageDescription", "$(PRODUCT_NAME) lets you choose photos to upload."]], android: [{ name: "android.permission.READ_MEDIA_IMAGES", note: "Android 13+" }, { name: "android.permission.READ_MEDIA_VIDEO", note: "Android 13+" }, { name: "android.permission.READ_MEDIA_VISUAL_USER_SELECTED", note: "Android 14+ partial access" }, { name: "android.permission.READ_EXTERNAL_STORAGE", extra: 'android:maxSdkVersion="32"' }], flutterMacro: "PERMISSION_PHOTOS", rnp: "PhotoLibrary", note: "To just let users pick photos, use the system photo picker (PHPickerViewController / Android Photo Picker, image_picker, expo-image-picker): it needs no permission. Google Play only allows READ_MEDIA_IMAGES/VIDEO for apps whose core feature needs broad library access." },
    { id: "photosAdd", label: "Save to photo library", ios: [["NSPhotoLibraryAddUsageDescription", "$(PRODUCT_NAME) saves photos you create to your library."]], android: [{ name: "android.permission.WRITE_EXTERNAL_STORAGE", extra: 'android:maxSdkVersion="28"', note: "MediaStore needs no permission on Android 10+" }], flutterMacro: "PERMISSION_PHOTOS_ADD_ONLY", rnp: "PhotoLibraryAddOnly" },
    { id: "locationWhenInUse", label: "Location (while using the app)", ios: [["NSLocationWhenInUseUsageDescription", "$(PRODUCT_NAME) uses your location to show nearby places."]], android: [{ name: "android.permission.ACCESS_COARSE_LOCATION" }, { name: "android.permission.ACCESS_FINE_LOCATION" }], flutterMacro: "PERMISSION_LOCATION_WHENINUSE", rnp: "LocationWhenInUse", note: "On Android 12+ users can grant only approximate location; request both and handle coarse-only." },
    { id: "locationAlways", label: "Location (background)", ios: [["NSLocationAlwaysAndWhenInUseUsageDescription", "$(PRODUCT_NAME) uses your location in the background to track your route."], ["NSLocationWhenInUseUsageDescription", "$(PRODUCT_NAME) uses your location to show nearby places."]], android: [{ name: "android.permission.ACCESS_BACKGROUND_LOCATION", note: "Request after foreground location; Play requires a declaration form and video" }], flutterMacro: "PERMISSION_LOCATION", rnp: "LocationAlways", note: "Background location needs UIBackgroundModes → location on iOS and a Play Console permission declaration on Android; both stores reject apps without a clear user-facing reason." },
    { id: "contacts", label: "Contacts", ios: [["NSContactsUsageDescription", "$(PRODUCT_NAME) finds friends from your contacts."]], android: [{ name: "android.permission.READ_CONTACTS" }], flutterMacro: "PERMISSION_CONTACTS", rnp: "Contacts" },
    { id: "calendar", label: "Calendar", ios: [["NSCalendarsFullAccessUsageDescription", "$(PRODUCT_NAME) adds your bookings to your calendar."], ["NSCalendarsUsageDescription", "$(PRODUCT_NAME) adds your bookings to your calendar."]], android: [{ name: "android.permission.READ_CALENDAR" }, { name: "android.permission.WRITE_CALENDAR" }], flutterMacro: "PERMISSION_EVENTS", rnp: "Calendars", note: "iOS 17+ uses NSCalendarsFullAccessUsageDescription (or NSCalendarsWriteOnlyAccessUsageDescription for add-only); keep the old key for iOS 16 and earlier." },
    { id: "notifications", label: "Push notifications", ios: [], android: [{ name: "android.permission.POST_NOTIFICATIONS", note: "Android 13+; ask at a meaningful moment, not at launch" }], flutterMacro: "PERMISSION_NOTIFICATIONS", rnp: "Notifications", note: "iOS needs no Info.plist key: request authorisation at runtime and enable the Push Notifications capability (plus Background Modes → Remote notifications for silent pushes)." },
    { id: "bluetooth", label: "Bluetooth", ios: [["NSBluetoothAlwaysUsageDescription", "$(PRODUCT_NAME) connects to your fitness devices over Bluetooth."]], android: [{ name: "android.permission.BLUETOOTH_SCAN", extra: 'android:usesPermissionFlags="neverForLocation"', note: "Android 12+; drop the flag if you derive location from scans" }, { name: "android.permission.BLUETOOTH_CONNECT", note: "Android 12+" }, { name: "android.permission.BLUETOOTH", extra: 'android:maxSdkVersion="30"' }, { name: "android.permission.BLUETOOTH_ADMIN", extra: 'android:maxSdkVersion="30"' }, { name: "android.permission.ACCESS_FINE_LOCATION", extra: 'android:maxSdkVersion="30"', note: "BLE scans needed location before Android 12" }], flutterMacro: "PERMISSION_BLUETOOTH", rnp: "Bluetooth" },
    { id: "biometrics", label: "Face ID / biometrics", ios: [["NSFaceIDUsageDescription", "$(PRODUCT_NAME) uses Face ID to unlock your account."]], android: [{ name: "android.permission.USE_BIOMETRIC" }], rnp: "FaceID" },
    { id: "tracking", label: "App Tracking Transparency (IDFA)", ios: [["NSUserTrackingUsageDescription", "Your data will be used to show you more relevant ads."]], android: [{ name: "com.google.android.gms.permission.AD_ID", note: "Required to read the advertising ID when targeting Android 13+" }], flutterMacro: "PERMISSION_APP_TRACKING_TRANSPARENCY", rnp: "AppTrackingTransparency", note: "Show the ATT prompt before any tracking SDK reads the IDFA; App Review rejects pre-prompt screens that pressure users." },
    { id: "speech", label: "Speech recognition", ios: [["NSSpeechRecognitionUsageDescription", "$(PRODUCT_NAME) turns your voice into text."], ["NSMicrophoneUsageDescription", "$(PRODUCT_NAME) uses the microphone for voice input."]], android: [{ name: "android.permission.RECORD_AUDIO" }], flutterMacro: "PERMISSION_SPEECH_RECOGNIZER", rnp: "SpeechRecognition" },
    { id: "motion", label: "Motion & fitness", ios: [["NSMotionUsageDescription", "$(PRODUCT_NAME) counts your steps."]], android: [{ name: "android.permission.ACTIVITY_RECOGNITION", note: "Android 10+" }], flutterMacro: "PERMISSION_SENSORS", rnp: "Motion" },
    { id: "localNetwork", label: "Local network", ios: [["NSLocalNetworkUsageDescription", "$(PRODUCT_NAME) finds devices on your local network."]], android: [{ name: "android.permission.NEARBY_WIFI_DEVICES", extra: 'android:usesPermissionFlags="neverForLocation"', note: "Android 13+, only for Wi-Fi device discovery" }], note: "iOS also needs NSBonjourServices listing each service type you browse (e.g. _http._tcp). Debug builds hitting a dev server on your LAN trigger this prompt too." },
    { id: "nfc", label: "NFC", ios: [["NFCReaderUsageDescription", "$(PRODUCT_NAME) reads NFC tags."]], android: [{ name: "android.permission.NFC" }], note: "iOS also needs the Near Field Communication Tag Reading capability." }
];
function permissionFiles(ids, framework) {
    const chosen = exports.PERMISSIONS.filter(p => ids.includes(p.id));
    if (!chosen.length)
        throw new types_1.ToolInputError("Turn on at least one permission.");
    const iosKeys = new Map();
    for (const p of chosen)
        for (const [k, v] of p.ios)
            if (!iosKeys.has(k))
                iosKeys.set(k, v);
    const android = new Map();
    android.set("android.permission.INTERNET", {});
    for (const p of chosen)
        for (const a of p.android)
            if (!android.has(a.name))
                android.set(a.name, a);
    const plist = [...iosKeys].map(([k, v]) => `<key>${k}</key>\n<string>${xmlEsc(v)}</string>`).join("\n") + (chosen.some(p => p.id === "locationAlways") ? "\n<key>UIBackgroundModes</key>\n<array>\n    <string>location</string>\n</array>" : "");
    const manifest = [...android].map(([name, a]) => `<uses-permission android:name="${name}"${a.extra ? ` ${a.extra}` : ""} />${a.note ? ` <!-- ${a.note} -->` : ""}`).join("\n");
    const outputs = [];
    const notes = chosen.filter(p => p.note).map(p => `${p.label}: ${p.note}`);
    notes.push("Usage descriptions must say why the app needs access; vague text (\"needs camera access\") is a common App Review rejection. Localise them with InfoPlist.strings.");
    if (framework === "expo") {
        const plugins = [];
        if (ids.includes("camera"))
            plugins.push(["expo-camera", { cameraPermission: iosKeys.get("NSCameraUsageDescription"), microphonePermission: ids.includes("microphone") ? iosKeys.get("NSMicrophoneUsageDescription") : false }]);
        if (ids.includes("photos") || ids.includes("photosAdd"))
            plugins.push(["expo-media-library", { photosPermission: iosKeys.get("NSPhotoLibraryUsageDescription") ?? iosKeys.get("NSPhotoLibraryAddUsageDescription"), savePhotosPermission: iosKeys.get("NSPhotoLibraryAddUsageDescription") ?? iosKeys.get("NSPhotoLibraryUsageDescription") }]);
        if (ids.includes("locationWhenInUse") || ids.includes("locationAlways"))
            plugins.push(["expo-location", { locationWhenInUsePermission: iosKeys.get("NSLocationWhenInUseUsageDescription"), ...(ids.includes("locationAlways") ? { locationAlwaysAndWhenInUsePermission: iosKeys.get("NSLocationAlwaysAndWhenInUseUsageDescription"), isAndroidBackgroundLocationEnabled: true } : {}) }]);
        if (ids.includes("tracking"))
            plugins.push(["expo-tracking-transparency", { userTrackingPermission: iosKeys.get("NSUserTrackingUsageDescription") }]);
        if (ids.includes("contacts"))
            plugins.push(["expo-contacts", { contactsPermission: iosKeys.get("NSContactsUsageDescription") }]);
        if (ids.includes("calendar"))
            plugins.push(["expo-calendar", { calendarPermission: iosKeys.get("NSCalendarsFullAccessUsageDescription") }]);
        if (ids.includes("biometrics"))
            plugins.push(["expo-local-authentication", { faceIDPermission: iosKeys.get("NSFaceIDUsageDescription") }]);
        outputs.push({ title: "app.json (merge into expo)", language: "json", content: JSON.stringify({ expo: { ios: { infoPlist: Object.fromEntries(iosKeys) }, android: { permissions: [...android.keys()].filter(k => k !== "android.permission.INTERNET"), blockedPermissions: ["android.permission.RECORD_AUDIO"].filter(k => !android.has(k)) }, plugins } }, null, 2) + "\n" });
        notes.push("Config plugins add the native keys at build time; rebuild (npx expo prebuild --clean or eas build) after changing them. Expo Go cannot use custom Info.plist text.");
    }
    outputs.push({ title: "Info.plist (ios/<App>/Info.plist)", language: "xml", content: plist + "\n" });
    outputs.push({ title: "AndroidManifest.xml (inside <manifest>, before <application>)", language: "xml", content: manifest + "\n" });
    if (framework === "flutter") {
        const macros = chosen.filter(p => p.flutterMacro).map(p => `        '${p.flutterMacro}=1',`);
        outputs.push({ title: "ios/Podfile (permission_handler)", language: "ruby", content: `# permission_handler compiles out every permission you do not enable here;\n# App Store Connect rejects apps whose binary references APIs without usage descriptions.\npost_install do |installer|\n  installer.pods_project.targets.each do |target|\n    flutter_additional_ios_build_settings(target)\n    target.build_configurations.each do |config|\n      config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= [\n        '$(inherited)',\n${macros.join("\n")}\n      ]\n    end\n  end\nend\n` });
        const DART = { camera: "camera", microphone: "microphone", photos: "photos", photosAdd: "photosAddOnly", locationWhenInUse: "locationWhenInUse", locationAlways: "locationAlways", contacts: "contacts", calendar: "calendarFullAccess", notifications: "notification", bluetooth: "bluetoothConnect", tracking: "appTrackingTransparency", speech: "speech", motion: "sensors" };
        const first = chosen.find(p => DART[p.id]);
        if (first)
            outputs.push({ title: "Request at runtime (Dart)", language: "dart", content: `import 'package:permission_handler/permission_handler.dart';\n\nFuture<bool> ensure${first.label.replace(/[^A-Za-z]/g, "")}Permission() async {\n  final status = await Permission.${DART[first.id]}.request();\n  if (status.isGranted || status.isLimited) return true;\n  if (status.isPermanentlyDenied) {\n    // The system will not ask again; send the user to Settings.\n    await openAppSettings();\n  }\n  return false;\n}\n` });
    }
    if (framework === "react-native") {
        const names = chosen.filter(p => p.rnp).map(p => `'${p.rnp}'`);
        outputs.push({ title: "ios/Podfile (react-native-permissions v4+)", language: "ruby", content: `def node_require(script)\n  require Pod::Executable.execute_command('node', ['-p',\n    "require.resolve('#{script}', {paths: [process.argv[1]]})", __dir__]).strip\nend\n\nnode_require('react-native/scripts/react_native_pods.rb')\nnode_require('react-native-permissions/scripts/setup.rb')\n\nsetup_permissions([\n${names.map(n => `  ${n},`).join("\n")}\n])\n` });
        const first = chosen.find(p => p.rnp) ?? chosen[0];
        const iosConst = { Camera: "CAMERA", Microphone: "MICROPHONE", PhotoLibrary: "PHOTO_LIBRARY", PhotoLibraryAddOnly: "PHOTO_LIBRARY_ADD_ONLY", LocationWhenInUse: "LOCATION_WHEN_IN_USE", LocationAlways: "LOCATION_ALWAYS", Contacts: "CONTACTS", Calendars: "CALENDARS", Bluetooth: "BLUETOOTH", FaceID: "FACE_ID", AppTrackingTransparency: "APP_TRACKING_TRANSPARENCY", SpeechRecognition: "SPEECH_RECOGNITION", Motion: "MOTION" }[first.rnp ?? "Camera"] ?? "CAMERA";
        const androidConst = (first.android[0]?.name.split(".").pop() ?? "CAMERA");
        outputs.push({ title: "Request at runtime (TypeScript)", language: "typescript", content: `import { Platform } from "react-native";\nimport { openSettings, PERMISSIONS, request, RESULTS } from "react-native-permissions";\n\nexport async function ensurePermission(): Promise<boolean> {\n  const permission = Platform.select({\n    ios: PERMISSIONS.IOS.${iosConst},\n    android: PERMISSIONS.ANDROID.${androidConst},\n  });\n  if (!permission) return false;\n  const result = await request(permission);\n  if (result === RESULTS.GRANTED || result === RESULTS.LIMITED) return true;\n  if (result === RESULTS.BLOCKED) await openSettings();\n  return false;\n}\n` });
        if (ids.includes("notifications"))
            notes.push("Notifications in react-native-permissions use requestNotifications(['alert', 'sound', 'badge']), not request().");
    }
    if (framework === "native") {
        const first = chosen[0].android[0]?.name ?? "android.permission.CAMERA";
        outputs.push({ title: "Request at runtime (Kotlin, Activity / Fragment)", language: "kotlin", content: `import android.Manifest\nimport android.content.pm.PackageManager\nimport androidx.activity.result.contract.ActivityResultContracts\nimport androidx.core.content.ContextCompat\n\nprivate val requestPermission =\n    registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->\n        if (granted) onPermissionGranted() else showRationaleOrSettings()\n    }\n\nfun ensurePermission() {\n    val permission = ${first.startsWith("android.permission.") ? `Manifest.permission.${first.split(".").pop()}` : JSON.stringify(first)}\n    when {\n        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED -> onPermissionGranted()\n        shouldShowRequestPermissionRationale(permission) -> showRationaleOrSettings()\n        else -> requestPermission.launch(permission)\n    }\n}\n` });
    }
    return { outputs, notes };
}
exports.permissionFiles = permissionFiles;
function parseEnvironments(text) {
    const envs = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#")).map(line => {
        const m = /^([A-Za-z][\w-]*)\s*[=:]\s*(\S+)$/.exec(line);
        if (!m)
            throw new types_1.ToolInputError(`"${line}" should be name=https://api.url, e.g. dev=https://dev.api.example.com.`);
        return { name: m[1].toLowerCase(), apiUrl: m[2] };
    });
    if (!envs.length)
        throw new types_1.ToolInputError("Add at least one environment, e.g. dev=https://dev.api.example.com.");
    return envs;
}
exports.parseEnvironments = parseEnvironments;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const isProd = (n) => /^(prod|production|release|live)$/.test(n);
function flavorFiles(envs, appName, appId, framework) {
    const files = [];
    const notes = [];
    const suffix = (e) => (isProd(e.name) ? "" : `.${e.name}`);
    const label = (e) => (isProd(e.name) ? appName : `${appName} ${cap(e.name)}`);
    const gradleFlavors = `android {\n    // AGP 8+: BuildConfig fields are off by default.\n    buildFeatures {\n        buildConfig = true\n    }\n\n    flavorDimensions += "env"\n    productFlavors {\n${envs.map(e => `        create("${e.name}") {\n            dimension = "env"\n${suffix(e) ? `            applicationIdSuffix = "${suffix(e)}"\n            versionNameSuffix = "-${e.name}"\n` : ""}            resValue("string", "app_name", "${label(e)}")\n            buildConfigField("String", "API_URL", "\\"${e.apiUrl}\\"")\n        }`).join("\n")}\n    }\n}\n`;
    let commands = "";
    const addAndroid = () => {
        files.push({ path: "app/build.gradle.kts.flavors", language: "kotlin", content: `// Merge into app/build.gradle.kts\n${gradleFlavors}` });
        files.push({ path: "app/src/main/java/config/AppConfig.kt", language: "kotlin", content: `package config\n\nimport ${appId}.BuildConfig\n\nobject AppConfig {\n    val apiUrl: String = BuildConfig.API_URL\n    val flavor: String = BuildConfig.FLAVOR\n    val isProduction: Boolean = BuildConfig.FLAVOR == "${envs.find(e => isProd(e.name))?.name ?? "prod"}"\n}\n` });
        commands = envs.map(e => `./gradlew assemble${cap(e.name)}Debug`).join("\n") + `\n./gradlew bundle${cap(envs[envs.length - 1].name)}Release`;
        notes.push("Per-flavor resources go in src/<flavor>/ (e.g. src/dev/google-services.json, src/dev/res/mipmap-*/ic_launcher.png for a different icon).");
    };
    const addIos = () => {
        for (const e of envs)
            files.push({ path: `ios/Config/${cap(e.name)}.xcconfig`, language: "properties", content: `// Set as the base configuration of the ${cap(e.name)} build configuration (Project → Info → Configurations).\n// "//" starts a comment in xcconfig files, so URLs are written as https:/$()/host\nAPI_URL = ${e.apiUrl.replace("://", ":/$()/")}\nPRODUCT_BUNDLE_IDENTIFIER = ${appId}${suffix(e)}\nPRODUCT_NAME = ${label(e)}\nAPP_ENV = ${e.name}\n` });
        files.push({ path: "ios/Config/AppConfig.swift", language: "swift", content: `import Foundation\n\n/// Reads values that Info.plist exposes from the xcconfig:\n/// <key>API_URL</key><string>$(API_URL)</string>\n/// <key>APP_ENV</key><string>$(APP_ENV)</string>\nenum AppConfig {\n    static let apiURL: URL = {\n        guard let value = Bundle.main.object(forInfoDictionaryKey: "API_URL") as? String, let url = URL(string: value) else {\n            fatalError("API_URL is missing from Info.plist")\n        }\n        return url\n    }()\n\n    static let environment = Bundle.main.object(forInfoDictionaryKey: "APP_ENV") as? String ?? "${envs[0].name}"\n}\n` });
        commands += `${commands ? "\n\n" : ""}${envs.map(e => `xcodebuild -scheme "${appName.replace(/\s/g, "")} ${cap(e.name)}" -configuration Release-${e.name} archive`).join("\n")}`;
        notes.push("Create one scheme per environment and check \"Shared\" so CI sees it.");
    };
    switch (framework) {
        case "flutter": {
            for (const e of envs)
                files.push({ path: `config/${e.name}.json`, language: "json", content: JSON.stringify({ ENV: e.name, API_URL: e.apiUrl, APP_NAME: label(e) }, null, 2) + "\n" });
            files.push({ path: "lib/config/env.dart", language: "dart", content: `/// Values come from --dart-define-from-file=config/<env>.json at build time.\nclass Env {\n  static const name = String.fromEnvironment('ENV', defaultValue: '${envs[0].name}');\n  static const apiUrl = String.fromEnvironment('API_URL', defaultValue: '${envs[0].apiUrl}');\n  static const appName = String.fromEnvironment('APP_NAME', defaultValue: '${appName}');\n\n  static bool get isProduction => name == '${envs.find(e => isProd(e.name))?.name ?? "prod"}';\n}\n` });
            files.push({ path: "android/app/build.gradle.kts.flavors", language: "kotlin", content: `// Merge into android/app/build.gradle.kts\n${gradleFlavors}` });
            files.push({ path: ".vscode/launch.json", language: "json", content: JSON.stringify({ version: "0.2.0", configurations: envs.map(e => ({ name: `${appName} (${e.name})`, request: "launch", type: "dart", program: "lib/main.dart", args: ["--flavor", e.name, "--dart-define-from-file", `config/${e.name}.json`] })) }, null, 2) + "\n" });
            commands = envs.map(e => `flutter run --flavor ${e.name} --dart-define-from-file=config/${e.name}.json`).join("\n") + `\n\nflutter build appbundle --flavor ${envs[envs.length - 1].name} --dart-define-from-file=config/${envs[envs.length - 1].name}.json\nflutter build ipa --flavor ${envs[envs.length - 1].name} --dart-define-from-file=config/${envs[envs.length - 1].name}.json`;
            notes.push(`iOS flavors need matching Xcode schemes (${envs.map(e => e.name).join(", ")}) and build configurations (Debug-${envs[0].name}, Release-${envs[0].name}, …): duplicate Debug/Release in Project → Info → Configurations, create a scheme per flavor, and set PRODUCT_BUNDLE_IDENTIFIER per configuration.`);
            notes.push("Values passed with --dart-define are compiled into the app binary: never put secrets in them.");
            break;
        }
        case "react-native": {
            for (const e of envs)
                files.push({ path: `.env.${e.name}`, language: "dotenv", content: `ENV=${e.name}\nAPI_URL=${e.apiUrl}\nAPP_NAME=${label(e)}\n` });
            files.push({ path: "android/app/build.gradle.flavors", language: "groovy", content: `// android/app/build.gradle (react-native-config)\nproject.ext.envConfigFiles = [\n${envs.map(e => `    ${e.name}: ".env.${e.name}",`).join("\n")}\n]\napply from: project(':react-native-config').projectDir.getPath() + "/dotenv.gradle"\n\nandroid {\n    flavorDimensions "env"\n    productFlavors {\n${envs.map(e => `        ${e.name} {\n            dimension "env"\n${suffix(e) ? `            applicationIdSuffix "${suffix(e)}"\n` : ""}            resValue "string", "build_config_package", "${appId}"\n        }`).join("\n")}\n    }\n}\n` });
            files.push({ path: "src/config/env.ts", language: "typescript", content: `import Config from "react-native-config";\n\nexport const env = {\n  name: Config.ENV ?? "${envs[0].name}",\n  apiUrl: Config.API_URL ?? "${envs[0].apiUrl}",\n  appName: Config.APP_NAME ?? "${appName}",\n};\n` });
            files.push({ path: "react-native-config.d.ts", language: "typescript", content: `declare module "react-native-config" {\n  export interface NativeConfig {\n    ENV?: string;\n    API_URL?: string;\n    APP_NAME?: string;\n  }\n  export const Config: NativeConfig;\n  export default Config;\n}\n` });
            commands = envs.map(e => `ENVFILE=.env.${e.name} npx react-native run-android --mode=${e.name}Debug`).join("\n") + `\n\n# iOS: create a scheme per env with a Build pre-action:\n#   cp "\${PROJECT_DIR}/../.env.${envs[0].name}" "\${PROJECT_DIR}/../.env"\nnpx react-native run-ios --scheme "${appName.replace(/\s/g, "")}-${envs[0].name}"`;
            notes.push("react-native-config values are bundled into the app and readable by anyone; keep secrets on the server.");
            break;
        }
        case "expo": {
            files.push({ path: "app.config.ts", language: "typescript", content: `import { ConfigContext, ExpoConfig } from "expo/config";\n\nconst VARIANT = process.env.APP_VARIANT ?? "${envs.find(e => isProd(e.name))?.name ?? envs[envs.length - 1].name}";\n\nconst VARIANTS: Record<string, { name: string; id: string }> = {\n${envs.map(e => `  ${JSON.stringify(e.name)}: { name: ${JSON.stringify(label(e))}, id: ${JSON.stringify(appId + suffix(e))} },`).join("\n")}\n};\n\nexport default ({ config }: ConfigContext): ExpoConfig => {\n  const variant = VARIANTS[VARIANT] ?? VARIANTS[${JSON.stringify(envs[0].name)}];\n  return {\n    ...config,\n    name: variant.name,\n    slug: ${JSON.stringify(appName.toLowerCase().replace(/[^a-z0-9]+/g, "-"))},\n    ios: { ...config.ios, bundleIdentifier: variant.id },\n    android: { ...config.android, package: variant.id },\n    extra: { ...config.extra, variant: VARIANT },\n  };\n};\n` });
            files.push({ path: "eas.json", language: "json", content: JSON.stringify({ cli: { version: ">= 12.0.0", appVersionSource: "remote" }, build: Object.fromEntries(envs.map(e => [isProd(e.name) ? "production" : e.name, { ...(isProd(e.name) ? { autoIncrement: true } : { distribution: "internal", ...(e.name === envs[0].name ? { developmentClient: true } : {}) }), channel: e.name, env: { APP_VARIANT: e.name, EXPO_PUBLIC_API_URL: e.apiUrl } }])), submit: { production: {} } }, null, 2) + "\n" });
            for (const e of envs)
                files.push({ path: `.env.${e.name}`, language: "dotenv", content: `# Loaded with: npx dotenv -e .env.${e.name} -- npx expo start\nAPP_VARIANT=${e.name}\nEXPO_PUBLIC_API_URL=${e.apiUrl}\n` });
            commands = `# Local\nAPP_VARIANT=${envs[0].name} npx expo start\n\n# Builds\n${envs.map(e => `eas build --profile ${isProd(e.name) ? "production" : e.name} --platform all`).join("\n")}\n\n# In code\nconst apiUrl = process.env.EXPO_PUBLIC_API_URL;`;
            notes.push("Different bundle IDs per variant let dev, staging and production builds sit side by side on one device.");
            notes.push("EXPO_PUBLIC_* variables are inlined into the JavaScript bundle; never put secrets in them.");
            break;
        }
        case "android":
            addAndroid();
            break;
        case "ios":
            addIos();
            break;
        case "native":
            addAndroid();
            addIos();
            break;
    }
    return { files, commands, notes };
}
exports.flavorFiles = flavorFiles;
// ---------------------------------------------------------------------------
// Device commands
// ---------------------------------------------------------------------------
function deviceCommands(platform, o) {
    const s = o.serial.trim() ? ` -s ${o.serial.trim()}` : "";
    const a = `adb${s}`;
    if (platform === "android")
        return [
            ["Devices", "List devices and emulators", "adb devices -l"],
            ["Devices", "Pair over Wi-Fi (Android 11+, Developer options → Wireless debugging)", "adb pair <ip>:<pairing-port>   # then: adb connect <ip>:<port>"],
            ["Devices", "List emulators / start one", "emulator -list-avds\nemulator -avd <name> -no-snapshot-load"],
            ["App", "Install (replace, allow downgrade, grant runtime permissions)", `${a} install -r -d -g ${o.apk}`],
            ["App", "Install a split/universal build from an .aab", `bundletool build-apks --bundle=app-release.aab --output=app.apks --connected-device\nbundletool install-apks --apks=app.apks`],
            ["App", "Uninstall (keep data with -k)", `${a} uninstall ${o.pkg}`],
            ["App", "Launch the app", `${a} shell monkey -p ${o.pkg} -c android.intent.category.LAUNCHER 1`],
            ["App", "Force stop", `${a} shell am force-stop ${o.pkg}`],
            ["App", "Clear app data (fresh install state)", `${a} shell pm clear ${o.pkg}`],
            ["App", "Installed version", `${a} shell dumpsys package ${o.pkg} | grep -E "versionName|versionCode|targetSdk"`],
            ["App", "Current foreground activity", `${a} shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity"`],
            ["App", "Pull the installed APK", `${a} shell pm path ${o.pkg}\n${a} pull <path-from-above> app.apk`],
            ["Logs", "Logs for this app only", `${a} logcat --pid=$(${a} shell pidof -s ${o.pkg})`],
            ["Logs", "Crashes only", `${a} logcat -b crash`],
            ["Logs", "Errors and React Native / Flutter output", `${a} logcat "*:E" ReactNativeJS:V flutter:V`],
            ["Logs", "Clear the log buffer", `${a} logcat -c`],
            ["Links", "Open a deep link", `${a} shell am start -W -a android.intent.action.VIEW -d "${o.url}" ${o.pkg}`],
            ["Links", "App Links verification status", `${a} shell pm get-app-links ${o.pkg}`],
            ["Network", "Reach your computer's localhost:PORT from the device", `${a} reverse tcp:${o.port} tcp:${o.port}`],
            ["Network", "Remove port reverses", `${a} reverse --remove-all`],
            ["Network", "Route through a debugging proxy (Charles, Proxyman, mitmproxy)", `${a} shell settings put global http_proxy ${o.proxy}`],
            ["Network", "Remove the proxy", `${a} shell settings put global http_proxy :0`],
            ["Permissions", "Grant / revoke a runtime permission", `${a} shell pm grant ${o.pkg} android.permission.CAMERA\n${a} shell pm revoke ${o.pkg} android.permission.CAMERA`],
            ["Permissions", "Reset all runtime permissions of the app", `${a} shell pm reset-permissions -p ${o.pkg}`],
            ["Screen", "Screenshot to your computer", `${a} exec-out screencap -p > screen.png`],
            ["Screen", "Record the screen (Ctrl+C to stop)", `${a} shell screenrecord /sdcard/demo.mp4\n${a} pull /sdcard/demo.mp4`],
            ["Screen", "Dark mode on / off", `${a} shell cmd uimode night yes\n${a} shell cmd uimode night no`],
            ["Screen", "Font scale (accessibility testing)", `${a} shell settings put system font_scale 1.3`],
            ["Screen", "Change screen size / density, then reset", `${a} shell wm size 1080x1920 && ${a} shell wm density 420\n${a} shell wm size reset && ${a} shell wm density reset`],
            ["Testing", "Disable animations (for UI tests)", `${a} shell settings put global window_animation_scale 0\n${a} shell settings put global transition_animation_scale 0\n${a} shell settings put global animator_duration_scale 0`],
            ["Testing", "Type text into the focused field", `${a} shell input text "hello%sworld"   # %s = space`],
            ["Testing", "Press Back / open the RN dev menu", `${a} shell input keyevent KEYCODE_BACK\n${a} shell input keyevent 82`],
            ["Testing", "Simulate process death (test state restoration)", `${a} shell am kill ${o.pkg}   # with the app in the background`],
            ["Files", "Push / pull files", `${a} push ./fixture.json /sdcard/Download/\n${a} pull /sdcard/Download/report.pdf .`],
            ["Files", "Browse app-private files (debuggable builds)", `${a} shell run-as ${o.pkg} ls -la files/`]
        ];
    if (platform === "ios-sim")
        return [
            ["Devices", "List simulators", "xcrun simctl list devices available"],
            ["Devices", "Boot a simulator and open the app", "xcrun simctl boot \"iPhone 16\" && open -a Simulator"],
            ["Devices", "Erase a simulator (factory reset)", "xcrun simctl shutdown booted && xcrun simctl erase booted"],
            ["App", "Install a .app build", "xcrun simctl install booted path/to/App.app"],
            ["App", "Launch / terminate", `xcrun simctl launch --console-pty booted ${o.bundle}\nxcrun simctl terminate booted ${o.bundle}`],
            ["App", "Uninstall", `xcrun simctl uninstall booted ${o.bundle}`],
            ["App", "Open the app's data container in Finder", `open "$(xcrun simctl get_app_container booted ${o.bundle} data)"`],
            ["Links", "Open a deep link / universal link", `xcrun simctl openurl booted "${o.url}"`],
            ["Push", "Send a test push notification", `cat > push.apns <<'EOF'\n{ "Simulator Target Bundle": "${o.bundle}", "aps": { "alert": { "title": "Hello", "body": "Test push" }, "sound": "default" } }\nEOF\nxcrun simctl push booted ${o.bundle} push.apns`],
            ["Permissions", "Grant / revoke / reset privacy permissions", `xcrun simctl privacy booted grant photos ${o.bundle}\nxcrun simctl privacy booted revoke camera ${o.bundle}\nxcrun simctl privacy booted reset all ${o.bundle}`],
            ["Location", "Set a location", "xcrun simctl location booted set 37.3349,-122.0090"],
            ["Screen", "Screenshot / record video (Ctrl+C to stop)", "xcrun simctl io booted screenshot screen.png\nxcrun simctl io booted recordVideo --codec=h264 demo.mp4"],
            ["Screen", "Dark mode", "xcrun simctl ui booted appearance dark   # or light"],
            ["Screen", "Larger text (Dynamic Type)", "xcrun simctl ui booted content_size extra-extra-large"],
            ["Screen", "Clean status bar for App Store screenshots", "xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3"],
            ["Media", "Add photos and videos to the library", "xcrun simctl addmedia booted ~/Pictures/sample.jpg"],
            ["Network", "localhost works as-is", `The simulator shares your Mac's network: use http://localhost:${o.port}`],
            ["Network", "Trust a proxy root certificate (Charles, Proxyman, mitmproxy)", "xcrun simctl keychain booted add-root-cert ~/Downloads/proxy-ca.pem"],
            ["Logs", "Stream the app's logs", `xcrun simctl spawn booted log stream --level debug --predicate 'subsystem == "${o.bundle}" OR process == "${o.bundle.split(".").pop()}"'`]
        ];
    return [
        ["Devices", "List connected devices (Xcode 15+, iOS 17+)", "xcrun devicectl list devices"],
        ["App", "Install a signed .app / .ipa", "xcrun devicectl device install app --device <udid> path/to/App.app"],
        ["App", "Launch the app", `xcrun devicectl device process launch --device <udid> ${o.bundle}`],
        ["App", "List installed apps", "xcrun devicectl device info apps --device <udid>"],
        ["Logs", "Device logs (macOS Console app is often easier)", "log stream --device <udid>   # or: idevicesyslog (libimobiledevice)"],
        ["Network", "Reach your Mac from the phone", `Use your Mac's LAN IP (ipconfig getifaddr en0), e.g. http://192.168.1.20:${o.port}. The dev server must listen on 0.0.0.0 and iOS 14+ asks for Local Network permission.`],
        ["Network", "Debugging proxy", `Settings → Wi-Fi → (i) → Configure Proxy → Manual: ${o.proxy}; then install and trust the proxy's root certificate (Settings → General → About → Certificate Trust Settings).`],
        ["Signing", "Which provisioning profiles are installed", "ls ~/Library/Developer/Xcode/UserData/Provisioning\\ Profiles/\nsecurity cms -D -i <profile>.mobileprovision | plutil -p -"],
        ["Builds", "Archive and export an .ipa", "xcodebuild -workspace App.xcworkspace -scheme App -configuration Release -archivePath build/App.xcarchive archive\nxcodebuild -exportArchive -archivePath build/App.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build"],
        ["Builds", "Upload to TestFlight", "xcrun altool --upload-app -f build/App.ipa -t ios --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>   # or: fastlane pilot upload"]
    ];
}
exports.deviceCommands = deviceCommands;
// ---------------------------------------------------------------------------
// Local API access from emulators and devices
// ---------------------------------------------------------------------------
function localApiAccess(port, lanIp, https, framework) {
    const scheme = https ? "https" : "http";
    const ip = lanIp || "192.168.1.20";
    const rows = [
        ["Android emulator", `${scheme}://10.0.2.2:${port}`, "10.0.2.2 is the emulator's alias for your computer's localhost. Or run adb reverse and use localhost."],
        ["Android emulator / USB device + adb reverse", `${scheme}://localhost:${port}`, `adb reverse tcp:${port} tcp:${port} - forwards the device's port to your computer (re-run after reconnecting).`],
        ["Genymotion", `${scheme}://10.0.3.2:${port}`, "Genymotion uses a different host alias."],
        ["iOS simulator", `${scheme}://localhost:${port}`, "The simulator shares the Mac's network stack."],
        ["Physical device on the same Wi-Fi", `${scheme}://${ip}:${port}`, "Your computer's LAN IP. The server must listen on 0.0.0.0 and the firewall must allow the port."],
        ["Anywhere (tunnel)", "https://<random>.ngrok-free.app", `ngrok http ${port}  ·  cloudflared tunnel --url http://localhost:${port} - gives an https URL that works on any network and satisfies ATS.`]
    ];
    const outputs = [];
    outputs.push({ title: "Make the dev server reachable (listen on all interfaces)", language: "shell", content: `# Next.js\nnext dev -H 0.0.0.0 -p ${port}\n# Vite\nvite --host 0.0.0.0 --port ${port}\n# Express / Node\napp.listen(${port}, "0.0.0.0")\n# NestJS\nawait app.listen(${port}, "0.0.0.0")\n# Django / FastAPI\npython manage.py runserver 0.0.0.0:${port}\nuvicorn main:app --host 0.0.0.0 --port ${port}\n# Find your LAN IP\nipconfig getifaddr en0          # macOS\nhostname -I | awk '{print $1}'  # Linux\nipconfig                        # Windows (IPv4 Address)` });
    if (!https) {
        outputs.push({ title: "Android: allow cleartext HTTP to your dev hosts (debug builds only)", language: "xml", fileName: "android/app/src/debug/res/xml/network_security_config.xml", content: `<?xml version="1.0" encoding="utf-8"?>\n<!-- Android 9+ blocks http:// by default. Put this in src/debug so release builds stay HTTPS-only. -->\n<network-security-config>\n    <domain-config cleartextTrafficPermitted="true">\n        <domain includeSubdomains="false">10.0.2.2</domain>\n        <domain includeSubdomains="false">10.0.3.2</domain>\n        <domain includeSubdomains="false">localhost</domain>\n        <domain includeSubdomains="false">${ip}</domain>\n    </domain-config>\n    <!-- Trust user-installed CAs (Charles, Proxyman, mitmproxy) in debug builds -->\n    <debug-overrides>\n        <trust-anchors>\n            <certificates src="system" />\n            <certificates src="user" />\n        </trust-anchors>\n    </debug-overrides>\n</network-security-config>\n` });
        outputs.push({ title: "Android: reference it from the debug manifest", language: "xml", fileName: "android/app/src/debug/AndroidManifest.xml", content: `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools">\n    <application\n        android:networkSecurityConfig="@xml/network_security_config"\n        tools:targetApi="28" />\n</manifest>\n` });
        outputs.push({ title: "iOS: allow local HTTP (App Transport Security)", language: "xml", content: `<!-- Info.plist. NSAllowsLocalNetworking covers localhost and .local hosts; a LAN IP needs an exception domain. -->\n<key>NSAppTransportSecurity</key>\n<dict>\n    <key>NSAllowsLocalNetworking</key>\n    <true/>\n    <key>NSExceptionDomains</key>\n    <dict>\n        <key>${ip}</key>\n        <dict>\n            <key>NSExceptionAllowsInsecureHTTPLoads</key>\n            <true/>\n        </dict>\n    </dict>\n</dict>\n<!-- Physical devices: iOS 14+ prompts for local network access -->\n<key>NSLocalNetworkUsageDescription</key>\n<string>Connects to the development server on your network.</string>\n` });
    }
    const base = (host) => `${scheme}://${host}:${port}`;
    if (framework === "flutter")
        outputs.push({ title: "Pick the base URL per platform (Dart)", language: "dart", content: `import 'dart:io' show Platform;\nimport 'package:flutter/foundation.dart';\n\n/// Override for physical devices: --dart-define=API_URL=${base(ip)}\nconst _override = String.fromEnvironment('API_URL');\n\nString get apiBaseUrl {\n  if (_override.isNotEmpty) return _override;\n  if (kIsWeb) return '${base("localhost")}';\n  if (Platform.isAndroid) return '${base("10.0.2.2")}';\n  return '${base("localhost")}';\n}\n` });
    else if (framework === "react-native" || framework === "expo")
        outputs.push({ title: "Pick the base URL per platform (TypeScript)", language: "typescript", content: `import { Platform } from "react-native";\n${framework === "expo" ? 'import Constants from "expo-constants";\n' : ""}\nfunction devHost(): string {\n${framework === "expo" ? "  // Expo knows the IP of the machine running Metro; works on emulators and physical devices.\n  const host = Constants.expoConfig?.hostUri?.split(\":\")[0];\n  if (host) return host;\n" : ""}  return Platform.OS === "android" ? "10.0.2.2" : "localhost";\n}\n\nexport const API_URL = __DEV__\n  ? \`${scheme}://\${devHost()}:${port}\`\n  : "https://api.example.com";\n` });
    else
        outputs.push({ title: "Kotlin (Android) / Swift (iOS)", language: "kotlin", content: `// Android: app/build.gradle.kts\nbuildTypes {\n    debug { buildConfigField("String", "API_URL", "\\"${base("10.0.2.2")}\\"") }\n    release { buildConfigField("String", "API_URL", "\\"https://api.example.com\\"") }\n}\n\n// iOS (Swift)\n// #if DEBUG\n// let apiURL = URL(string: "${base("localhost")}")!\n// #else\n// let apiURL = URL(string: "https://api.example.com")!\n// #endif\n` });
    const notes = [
        "\"Network request failed\" / \"Connection refused\" from an emulator almost always means the app called localhost (which is the emulator itself) or the server listens on 127.0.0.1 only.",
        "CORS does not apply to native HTTP clients (fetch in React Native, Dart http, OkHttp, URLSession) - only to web views and browsers.",
        "Self-signed HTTPS certificates are rejected on devices; use a tunnel (ngrok, cloudflared) or mkcert with its root CA installed on the device."
    ];
    return { rows, outputs, notes };
}
exports.localApiAccess = localApiAccess;
const NAMED = { black: "000000", white: "ffffff", red: "ff0000", green: "008000", blue: "0000ff", yellow: "ffff00", cyan: "00ffff", magenta: "ff00ff", gray: "808080", grey: "808080", silver: "c0c0c0", maroon: "800000", olive: "808000", lime: "00ff00", aqua: "00ffff", teal: "008080", navy: "000080", fuchsia: "ff00ff", purple: "800080", orange: "ffa500", pink: "ffc0cb", brown: "a52a2a", indigo: "4b0082", violet: "ee82ee", gold: "ffd700", coral: "ff7f50", salmon: "fa8072", tomato: "ff6347", crimson: "dc143c", transparent: "00000000", rebeccapurple: "663399", slategray: "708090", tan: "d2b48c", beige: "f5f5dc", khaki: "f0e68c", turquoise: "40e0d0", skyblue: "87ceeb", lightgray: "d3d3d3", darkgray: "a9a9a9" };
function parseColor(input, eightDigit) {
    const t = input.trim().toLowerCase().replace(/;$/, "");
    if (!t)
        throw new types_1.ToolInputError("Enter a colour, e.g. #1E88E5, rgb(30 136 229), 0xFF1E88E5 or Color(0xFF1E88E5).");
    if (NAMED[t])
        return parseColor(`#${NAMED[t]}`, "css");
    let m;
    const n = (s) => (s.endsWith("%") ? Number(s.slice(0, -1)) * 2.55 : Number(s));
    const alpha = (s) => (s === undefined ? 1 : s.endsWith("%") ? Number(s.slice(0, -1)) / 100 : Number(s));
    if ((m = /^(?:color\(|colors?\.fromargb\(|uicolor\(|color\.fromrgbo\()?\s*0x([0-9a-f]{8}|[0-9a-f]{6})\)?$/.exec(t))) {
        const h = m[1].length === 6 ? `ff${m[1]}` : m[1];
        return { a: parseInt(h.slice(0, 2), 16) / 255, r: parseInt(h.slice(2, 4), 16), g: parseInt(h.slice(4, 6), 16), b: parseInt(h.slice(6, 8), 16) };
    }
    if ((m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t))) {
        let h = m[1];
        if (h.length <= 4)
            h = h.split("").map(c => c + c).join("");
        if (h.length === 6)
            return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
        if (eightDigit === "argb")
            return { a: parseInt(h.slice(0, 2), 16) / 255, r: parseInt(h.slice(2, 4), 16), g: parseInt(h.slice(4, 6), 16), b: parseInt(h.slice(6, 8), 16) };
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16) / 255 };
    }
    if ((m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(t)))
        return { r: n(m[1]), g: n(m[2]), b: n(m[3]), a: alpha(m[4]) };
    if ((m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(t)))
        return { ...hslToRgb(Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100), a: alpha(m[4]) };
    if ((m = /^color\.fromargb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(t)))
        return { a: Number(m[1]) / 255, r: Number(m[2]), g: Number(m[3]), b: Number(m[4]) };
    if ((m = /^color\.fromrgbo\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(t)))
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]) };
    if ((m = /red:\s*([\d.]+)\s*(?:\/\s*255(?:\.0)?)?\s*,\s*green:\s*([\d.]+)\s*(?:\/\s*255(?:\.0)?)?\s*,\s*blue:\s*([\d.]+)\s*(?:\/\s*255(?:\.0)?)?(?:\s*,\s*(?:alpha|opacity):\s*([\d.]+))?/.exec(t))) {
        const scale = /\/\s*255/.test(t) || [m[1], m[2], m[3]].some(v => Number(v) > 1) ? 1 : 255;
        return { r: Number(m[1]) * scale, g: Number(m[2]) * scale, b: Number(m[3]) * scale, a: m[4] === undefined ? 1 : Number(m[4]) };
    }
    throw new types_1.ToolInputError(`Cannot read "${input.trim()}". Try #RRGGBB, #RRGGBBAA, rgb()/rgba(), hsl(), 0xAARRGGBB, Color(0xAARRGGBB) or a CSS colour name.`);
}
exports.parseColor = parseColor;
function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}
function rgbToHsl({ r, g, b }) {
    const R = r / 255, G = g / 255, B = b / 255;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const l = (max + min) / 2;
    if (max === min)
        return [0, 0, Math.round(l * 100)];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}
exports.rgbToHsl = rgbToHsl;
const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0").toUpperCase();
const f3 = (n) => Number(n.toFixed(3)).toString();
function colorFormats(c) {
    const rgb = `${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
    const A = hex2(c.a * 255);
    const [h, s, l] = rgbToHsl(c);
    const opaque = c.a >= 0.999;
    const R = Math.round(c.r), G = Math.round(c.g), B = Math.round(c.b);
    return [
        ["CSS hex", opaque ? `#${rgb}` : `#${rgb}${A}`],
        ["CSS rgb()", opaque ? `rgb(${R} ${G} ${B})` : `rgb(${R} ${G} ${B} / ${f3(c.a)})`],
        ["CSS hsl()", opaque ? `hsl(${h} ${s}% ${l}%)` : `hsl(${h} ${s}% ${l}% / ${f3(c.a)})`],
        ["Tailwind (arbitrary value)", `bg-[#${rgb}${opaque ? "" : A}]`],
        ["React Native", opaque ? `"#${rgb}"` : `"rgba(${R}, ${G}, ${B}, ${f3(c.a)})"`],
        ["Android XML (#AARRGGBB)", `<color name="brand">#${A}${rgb}</color>`],
        ["Jetpack Compose", `Color(0x${A}${rgb})`],
        ["Android (Kotlin, View)", `Color.parseColor("#${A}${rgb}")`],
        ["Flutter", `Color(0x${A}${rgb})`],
        ["Flutter (fromARGB)", `Color.fromARGB(${Math.round(c.a * 255)}, ${R}, ${G}, ${B})`],
        ["SwiftUI", `Color(red: ${f3(c.r / 255)}, green: ${f3(c.g / 255)}, blue: ${f3(c.b / 255)}${opaque ? "" : `, opacity: ${f3(c.a)}`})`],
        ["UIKit", `UIColor(red: ${f3(c.r / 255)}, green: ${f3(c.g / 255)}, blue: ${f3(c.b / 255)}, alpha: ${f3(c.a)})`]
    ];
}
exports.colorFormats = colorFormats;
function relativeLuminance({ r, g, b }) {
    const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
exports.relativeLuminance = relativeLuminance;
function contrastRatio(a, b) {
    const [x, y] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}
exports.contrastRatio = contrastRatio;
function shades(c) {
    const [h, s] = rgbToHsl(c);
    const stops = [["50", 97], ["100", 93], ["200", 85], ["300", 74], ["400", 62], ["500", 50], ["600", 42], ["700", 34], ["800", 26], ["900", 18], ["950", 11]];
    return stops.map(([name, l]) => {
        const rgb = hslToRgb(h, s / 100, l / 100);
        return [name, `#${hex2(rgb.r)}${hex2(rgb.g)}${hex2(rgb.b)}`];
    });
}
exports.shades = shades;
// ---------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------
exports.ANDROID_DENSITIES = [["ldpi", 0.75, 120], ["mdpi", 1, 160], ["hdpi", 1.5, 240], ["xhdpi", 2, 320], ["xxhdpi", 3, 480], ["xxxhdpi", 4, 640]];
function densityTable(value, unit, fromDensity, fontScale) {
    const dp = unit === "px" ? value / fromDensity : unit === "sp" ? value * fontScale : value;
    const rows = exports.ANDROID_DENSITIES.map(([name, factor, dpi]) => [`Android ${name} (${dpi} dpi, ${factor}x)`, `${f3(dp * factor)} px`, `${f3(dp)} dp`]);
    rows.push(["iOS @1x", `${f3(dp)} px`, `${f3(dp)} pt`], ["iOS @2x", `${f3(dp * 2)} px`, `${f3(dp)} pt`], ["iOS @3x", `${f3(dp * 3)} px`, `${f3(dp)} pt`]);
    rows.push(["Web (CSS px, 16px root)", `${f3(dp)} px`, `${f3(dp / 16)} rem`]);
    rows.push(["Flutter / React Native (logical pixels)", `${f3(dp)}`, "1 logical px = 1 dp = 1 pt"]);
    return rows;
}
exports.densityTable = densityTable;
exports.ASSET_SIZES = [
    ["Android launcher icon (legacy)", "48 dp", "mdpi 48 · hdpi 72 · xhdpi 96 · xxhdpi 144 · xxxhdpi 192 px"],
    ["Android adaptive icon layers", "108 dp (safe zone 66 dp circle)", "xxxhdpi 432×432 px foreground + background; keep the logo inside the central 66 dp"],
    ["Android monochrome (themed) icon", "108 dp", "Same as the foreground; Android 13+ themed icons"],
    ["Android 12+ splash icon", "288 dp without background (fits a 192 dp circle) · 240 dp with icon background (160 dp circle)", "xxxhdpi 1152 / 960 px"],
    ["Android notification icon", "24 dp, white on transparent", "mdpi 24 · hdpi 36 · xhdpi 48 · xxhdpi 72 · xxxhdpi 96 px"],
    ["Google Play store icon", "512×512 px", "32-bit PNG, no rounded corners or shadow (Play applies the mask)"],
    ["Google Play feature graphic", "1024×500 px", "JPG or 24-bit PNG, no transparency"],
    ["iOS app icon (Xcode 14+)", "1024×1024 px single size", "No transparency, no rounded corners; Xcode generates every size. iOS 18+ also supports dark and tinted variants."],
    ["iOS minimum tap target", "44×44 pt", "Android equivalent: 48×48 dp"],
    ["App Store screenshots (iPhone 6.9\")", "1320×2868 or 1290×2796 px", "Portrait; the 6.9\" set can be reused for smaller iPhones"],
    ["App Store screenshots (iPad 13\")", "2064×2752 or 2048×2732 px", "Required if the app runs on iPad"],
    ["Favicon / PWA", "32×32 favicon.ico, 180×180 apple-touch-icon, 192 and 512 manifest icons + 512 maskable", "Web apps and Expo web"]
];
//# sourceMappingURL=mobile-config.js.map