"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOBILE_TOOLS = exports.SAMPLE_CERT = void 0;
const os_1 = require("os");
const types_1 = require("../types");
const mobile_config_1 = require("../engines/mobile-config");
const mobile_build_1 = require("../engines/mobile-build");
const helpers_1 = require("./helpers");
const FRAMEWORKS = (0, helpers_1.opts)(["react-native", "React Native (bare)"], ["expo", "Expo"], ["flutter", "Flutter"], ["native", "Native Android + iOS"]);
// ---------------------------------------------------------------------------
// Links & app config
// ---------------------------------------------------------------------------
const deepLinks = {
    id: "mobile.deep-links",
    command: "deepLinkHelper",
    title: "Deep Links & Universal Links",
    summary: "Generate apple-app-site-association, assetlinks.json, Android intent filters, iOS entitlements and React Navigation / Expo / go_router config for your paths - plus a path matcher and the adb/simctl commands to test and verify.",
    guide: "Universal Links (iOS) and App Links (Android) open https URLs in your app after the OS verifies files served from your domain's /.well-known/ folder. Both files must be served over HTTPS, without redirects, as JSON. Use ! to exclude a path (iOS only), :param or * for wildcards.",
    keywords: ["deep link", "universal links", "app links", "apple-app-site-association", "aasa", "assetlinks.json", "intent filter", "associated domains", "url scheme", "linking"],
    icon: "link",
    fields: [
        helpers_1.f.text("domain", "Domain", { width: "narrow", required: true, default: "example.com" }),
        helpers_1.f.text("scheme", "Custom scheme (optional)", { width: "narrow", default: "exampleapp" }),
        helpers_1.f.select("framework", "App framework", FRAMEWORKS),
        helpers_1.f.text("androidPackage", "Android package", { width: "narrow", default: "com.example.app", group: "Android" }),
        helpers_1.f.area("fingerprints", "SHA-256 signing fingerprints (one per line)", { rows: 3, default: "14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5", help: "Debug, upload and Play App Signing keys - see Signing & Keystores." }),
        helpers_1.f.text("teamId", "Apple Team ID", { width: "narrow", default: "ABCDE12345", group: "iOS" }),
        helpers_1.f.text("bundleId", "Bundle ID", { width: "narrow", default: "com.example.app" }),
        helpers_1.f.area("paths", "Paths (one per line)", { rows: 4, default: "/products/*\n/invite/:code\n/orders/*\n!/account/delete", group: "Routes" }),
        helpers_1.f.text("testPath", "Test a URL path", { default: "/products/42?ref=email" })
    ],
    run(values) {
        const fingerprints = (0, types_1.str)(values, "fingerprints").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const paths = (0, types_1.str)(values, "paths").split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(p => (p.startsWith("/") || p.startsWith("!") ? p : `/${p}`));
        const r = (0, mobile_config_1.deepLinkFiles)({ domain: (0, types_1.required)(values, "domain", "Domain"), scheme: (0, types_1.str)(values, "scheme"), androidPackage: (0, types_1.str)(values, "androidPackage").trim(), fingerprints, teamId: (0, types_1.str)(values, "teamId").trim(), bundleId: (0, types_1.str)(values, "bundleId").trim(), paths, framework: (0, types_1.str)(values, "framework", "react-native") });
        const outputs = [{ kind: "files", title: "Files", files: r.files }];
        const test = (0, types_1.str)(values, "testPath").trim();
        if (test) {
            const path = test.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0] || "/";
            const rows = paths.map(p => [p, (0, mobile_config_1.pathMatches)(p, path) ? (p.startsWith("!") ? "excluded (iOS)" : "✓ opens the app") : "no"]);
            const opens = paths.some(p => !p.startsWith("!") && (0, mobile_config_1.pathMatches)(p, path)) && !paths.some(p => p.startsWith("!") && (0, mobile_config_1.pathMatches)(p, path));
            outputs.unshift((0, helpers_1.table)(`Does ${path} open the app?`, ["Pattern", "Result"], rows));
            r.warnings.unshift(opens ? `${path} opens the app.` : `${path} does not open the app; it loads in the browser.`);
        }
        outputs.push((0, helpers_1.code)("Test and verify", "shell", r.tests));
        const messages = r.warnings.map((t, i) => ({ kind: i === 0 && test ? "info" : "warning", text: t }));
        messages.push({ kind: "info", text: "Apple caches apple-app-site-association through its CDN (it can take hours to update). Android re-verifies on install/update; check with adb shell pm get-app-links." });
        return { messages, outputs };
    }
};
const permissions = {
    id: "mobile.permissions",
    command: "appPermissions",
    title: "App Permissions Generator",
    summary: "Pick the capabilities your app uses (camera, photos, location, notifications, Bluetooth, tracking…) and get Info.plist usage strings, AndroidManifest entries with the right SDK limits, Expo config plugins, Podfile macros and runtime request code.",
    keywords: ["permissions", "info.plist", "usage description", "androidmanifest", "uses-permission", "permission_handler", "react-native-permissions", "expo permissions", "NSCameraUsageDescription", "POST_NOTIFICATIONS"],
    icon: "checklist",
    fields: [
        helpers_1.f.select("framework", "App framework", FRAMEWORKS),
        ...mobile_config_1.PERMISSIONS.map((p, i) => helpers_1.f.toggle(`perm_${p.id}`, p.label, ["camera", "photos", "notifications"].includes(p.id), i === 0 ? { group: "Permissions" } : {}))
    ],
    run(values) {
        const ids = mobile_config_1.PERMISSIONS.filter(p => (0, types_1.bool)(values, `perm_${p.id}`)).map(p => p.id);
        const r = (0, mobile_config_1.permissionFiles)(ids, (0, types_1.str)(values, "framework", "react-native"));
        return { stats: [{ label: "Permissions", value: String(ids.length) }], messages: r.notes.map(t => ({ kind: "info", text: t })), outputs: r.outputs.map(o => (0, helpers_1.code)(o.title, o.language, o.content, o.fileName)) };
    }
};
const flavors = {
    id: "mobile.environments",
    command: "appEnvironments",
    title: "Environments & Build Flavors",
    summary: "Set up dev / staging / production builds with their own API URL, app name and bundle ID: Android product flavors, iOS xcconfig + schemes, Flutter --dart-define-from-file, react-native-config or Expo app.config + EAS profiles.",
    guide: "One line per environment: name=API URL. Production (prod/production/release) keeps the base app ID; the others get a suffix so all builds can be installed side by side.",
    keywords: ["flavors", "product flavors", "build variants", "schemes", "xcconfig", "environment", "staging", "dart-define", "react-native-config", "app.config", "eas.json", "app variant"],
    icon: "sliders",
    fields: [
        helpers_1.f.select("framework", "Platform", (0, helpers_1.opts)(["flutter", "Flutter"], ["react-native", "React Native (bare)"], ["expo", "Expo"], ["native", "Native Android + iOS"], ["android", "Android only"], ["ios", "iOS only"])),
        helpers_1.f.text("appName", "App name", { width: "narrow", default: "Acme" }),
        helpers_1.f.text("appId", "Base app ID", { width: "narrow", default: "com.acme.app" }),
        helpers_1.f.area("envs", "Environments", { rows: 4, required: true, default: "dev=http://10.0.2.2:3000\nstaging=https://staging-api.acme.com\nprod=https://api.acme.com" })
    ],
    run(values) {
        const appId = (0, types_1.required)(values, "appId", "App ID");
        if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(appId))
            throw new types_1.ToolInputError("Use a reverse-domain app ID like com.acme.app.");
        const r = (0, mobile_config_1.flavorFiles)((0, mobile_config_1.parseEnvironments)((0, types_1.str)(values, "envs")), (0, types_1.str)(values, "appName", "App"), appId, (0, types_1.str)(values, "framework", "flutter"));
        return { messages: r.notes.map(t => ({ kind: "info", text: t })), outputs: [{ kind: "files", title: "Files", files: r.files }, (0, helpers_1.code)("Run and build", "shell", r.commands)] };
    }
};
// ---------------------------------------------------------------------------
// Signing & security
// ---------------------------------------------------------------------------
const signing = {
    id: "mobile.signing",
    command: "appSigning",
    title: "Signing, Keystores & Fingerprints",
    summary: "Create an Android upload keystore, wire it into Gradle and CI, print SHA-1/SHA-256 fingerprints, convert fingerprints between hex and Base64 (Facebook key hash), and the iOS certificate and profile commands.",
    guide: "Fingerprints are needed for Firebase, Google Sign-In, Maps API key restrictions and App Links. With Play App Signing, Google re-signs your app: register the app signing key's fingerprint (Play Console → Setup → App integrity) as well as your upload and debug keys.",
    keywords: ["keystore", "keytool", "jks", "signing", "upload key", "sha1", "sha256", "fingerprint", "key hash", "facebook key hash", "signingReport", "provisioning profile", "p12", "fastlane match"],
    icon: "key",
    live: true,
    fields: [
        helpers_1.f.select("mode", "Tool", (0, helpers_1.opts)(["android", "Android keystore & Gradle"], ["fingerprint", "Convert a fingerprint"], ["ios", "iOS certificates & profiles"])),
        helpers_1.f.text("alias", "Key alias", { width: "narrow", default: "upload", showIf: { field: "mode", equals: ["android"] } }),
        helpers_1.f.text("file", "Keystore file", { width: "narrow", default: "upload-keystore.jks", showIf: { field: "mode", equals: ["android"] } }),
        helpers_1.f.num("validity", "Validity (years)", 27, { min: 1, max: 100, showIf: { field: "mode", equals: ["android"] }, help: "Google Play requires keys valid until at least 22 Oct 2033; 25+ years is standard." }),
        helpers_1.f.text("cn", "Name (CN)", { width: "narrow", default: "Acme Inc", showIf: { field: "mode", equals: ["android"] } }),
        helpers_1.f.text("org", "Organisation (O)", { width: "narrow", default: "Acme", showIf: { field: "mode", equals: ["android"] } }),
        helpers_1.f.text("country", "Country (C)", { width: "narrow", default: "US", showIf: { field: "mode", equals: ["android"] } }),
        helpers_1.f.area("fingerprint", "Fingerprint (hex or Base64)", { rows: 2, default: "5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25", showIf: { field: "mode", equals: ["fingerprint"] } })
    ],
    run(values) {
        const mode = (0, types_1.str)(values, "mode", "android");
        if (mode === "fingerprint") {
            const r = (0, mobile_build_1.convertFingerprint)((0, types_1.required)(values, "fingerprint", "Fingerprint"));
            return {
                stats: [{ label: "Algorithm", value: r.algorithm }, { label: "Bytes", value: String(r.bytes) }],
                messages: [{ kind: "info", text: r.algorithm === "SHA-1" ? "SHA-1: used by Firebase (Google Sign-In, Dynamic Links), Maps API key restrictions and the Facebook key hash (Base64 form)." : "SHA-256: used by App Links (assetlinks.json), Firebase App Check and Play Integrity." }],
                outputs: [(0, helpers_1.table)("Formats", ["Format", "Value", "Used by"], [["Colon hex (keytool)", r.colonHex, "Firebase console, Google Cloud, assetlinks.json"], ["Plain hex", r.hex, "APIs and scripts"], ["Base64", r.base64, r.algorithm === "SHA-1" ? "Facebook / Meta key hash" : "Pinning, some SDKs"], ["Base64URL", r.base64url, "URL-safe contexts"]])]
            };
        }
        const c = (0, mobile_build_1.keystoreCommands)({ alias: (0, types_1.str)(values, "alias", "upload").trim() || "upload", file: (0, types_1.str)(values, "file", "upload-keystore.jks").trim() || "upload-keystore.jks", validityYears: (0, types_1.num)(values, "validity", 27, { min: 1, max: 100, label: "Validity" }), dname: { cn: (0, types_1.str)(values, "cn", "Acme"), o: (0, types_1.str)(values, "org", "Acme"), c: (0, types_1.str)(values, "country", "US") } });
        if (mode === "ios")
            return { messages: [{ kind: "info", text: "Use App Store Connect API keys (.p8) for CI uploads instead of an Apple ID and app-specific password." }], outputs: [(0, helpers_1.code)("iOS signing", "shell", c.ios)] };
        const messages = [{ kind: "warning", text: "Never commit the keystore or key.properties. Add *.jks, *.keystore and key.properties to .gitignore." }];
        if ((0, types_1.num)(values, "validity", 27, { min: 1, max: 100 }) < 25)
            messages.push({ kind: "warning", text: "Google Play requires signing keys valid until at least 22 October 2033; use 25 years or more." });
        return { messages, outputs: [(0, helpers_1.code)("1. Create the upload keystore", "shell", c.create), (0, helpers_1.code)("2. android/key.properties", "properties", c.properties, "android/key.properties"), (0, helpers_1.code)("3a. build.gradle.kts", "kotlin", c.gradleKts), (0, helpers_1.code)("3b. build.gradle (Groovy)", "groovy", c.gradleGroovy), (0, helpers_1.code)("Fingerprints (SHA-1 / SHA-256)", "shell", c.fingerprints), (0, helpers_1.code)("CI (GitHub Actions)", "yaml", c.ci)] };
    }
};
/** A self-signed sample (api.example.com, EC P-256) so the tool can be tried without a real certificate. */
exports.SAMPLE_CERT = `-----BEGIN CERTIFICATE-----
MIIBijCCATCgAwIBAgIJANS1AEi3smMLMAoGCCqGSM49BAMCMDMxGDAWBgNVBAMM
D2FwaS5leGFtcGxlLmNvbTEXMBUGA1UECgwORGV2U25pcCBTYW1wbGUwHhcNMjYx
MDAxMTExMjQ4WhcNMzYwOTI4MTExMjQ4WjAzMRgwFgYDVQQDDA9hcGkuZXhhbXBs
ZS5jb20xFzAVBgNVBAoMDkRldlNuaXAgU2FtcGxlMFkwEwYHKoZIzj0CAQYIKoZI
zj0DAQcDQgAErvfS7m+8qFs4+SuPqs1m3VxeNwE/i7aWvvulavXpXtQL77ajvCPP
XOa4BUC0LAY1ryVTGBUvltiP3rwjE0Ve6KMtMCswKQYDVR0RBCIwIIIPYXBpLmV4
YW1wbGUuY29tgg0qLmV4YW1wbGUuY29tMAoGCCqGSM49BAMCA0gAMEUCIQD59enX
Xti35KUE9fR3sq1hV0c5WkyxbOmUvZLwmpSsDwIgHE74aLcNjKIws78MpSBF7wDK
MZVpQdcyd3OmW+tqT58=
-----END CERTIFICATE-----`;
const certificates = {
    id: "mobile.certificates",
    command: "certInspector",
    title: "Certificate & SSL Pinning Inspector",
    summary: "Decode PEM certificates locally: subject, issuer, SANs, validity, key type, SHA-1/SHA-256 fingerprints and the SPKI pin - then get OkHttp, Android network security config and iOS NSPinnedDomains pinning config.",
    guide: "Pin the public key (SPKI), not the certificate, and always include a backup pin (e.g. the intermediate CA or a pre-generated spare key). A pin that no longer matches bricks networking for every installed app until users update.",
    keywords: ["certificate", "x509", "pem", "ssl", "tls", "pinning", "spki", "fingerprint", "openssl", "network security config", "certificatepinner", "NSPinnedDomains"],
    icon: "fingerprint",
    live: true,
    examples: [{ label: "Sample self-signed certificate", values: { pem: exports.SAMPLE_CERT, host: "api.example.com" } }],
    fields: [
        helpers_1.f.code("pem", "Certificate(s) (PEM)", "text", { rows: 12, required: true, fromEditor: true, placeholder: "-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----" }),
        helpers_1.f.text("host", "Host to pin", { width: "narrow", default: "api.example.com" }),
        helpers_1.f.text("expiry", "Pin-set expiration", { width: "narrow", default: "2027-12-31", help: "Android stops enforcing pins after this date (a safety valve)." })
    ],
    run(values, ctx) {
        const certs = (0, mobile_build_1.parseCertificates)((0, types_1.required)(values, "pem", "Certificate"), ctx.now?.() ?? new Date());
        const messages = [];
        for (const [i, c] of certs.entries()) {
            const label = `Certificate ${i + 1} (${c.subject.split(", ").find(p => p.startsWith("CN="))?.slice(3) ?? c.subject.slice(0, 40)})`;
            if (c.daysLeft < 0)
                messages.push({ kind: "error", text: `${label} expired ${-c.daysLeft} days ago.` });
            else if (c.daysLeft < 30)
                messages.push({ kind: "warning", text: `${label} expires in ${c.daysLeft} days.` });
            if (c.selfSigned && !c.ca)
                messages.push({ kind: "warning", text: `${label} is self-signed: devices reject it unless its CA is installed and trusted.` });
            if (/RSA (512|1024)-bit/.test(c.keyType))
                messages.push({ kind: "error", text: `${label} uses a weak ${c.keyType} key.` });
        }
        const pins = [...new Set(certs.map(c => c.spkiPin))];
        if (pins.length < 2)
            messages.push({ kind: "warning", text: "Only one pin: add a backup (the intermediate certificate's pin, or a spare key you have not deployed yet) before shipping." });
        const s = (0, mobile_build_1.pinningSnippets)((0, types_1.str)(values, "host", "api.example.com").trim(), pins, (0, types_1.str)(values, "expiry", "2027-12-31").trim());
        return {
            stats: [{ label: "Certificates", value: String(certs.length) }, { label: "Leaf expires", value: `${certs[0].daysLeft} days`, tone: certs[0].daysLeft < 0 ? "bad" : certs[0].daysLeft < 30 ? "warn" : "good" }],
            messages,
            outputs: [
                (0, helpers_1.table)("Certificates", ["#", "Subject", "Issuer", "Valid until", "Key", "SANs"], certs.map((c, i) => [i + 1, c.subject, c.issuer, c.validTo.toISOString().slice(0, 10), c.keyType, c.sans.slice(0, 6).join(", ") + (c.sans.length > 6 ? ` (+${c.sans.length - 6})` : "")])),
                (0, helpers_1.table)("Fingerprints and pins", ["#", "SHA-256 fingerprint", "SHA-1 fingerprint", "SPKI pin (sha256/…)"], certs.map((c, i) => [i + 1, c.sha256, c.sha1, c.spkiPin])),
                (0, helpers_1.code)("OkHttp (Android / Kotlin)", "kotlin", s.okhttp),
                (0, helpers_1.code)("Android network_security_config.xml", "xml", s.android, "android/app/src/main/res/xml/network_security_config.xml"),
                (0, helpers_1.code)("iOS Info.plist", "xml", s.ios),
                (0, helpers_1.code)("openssl", "shell", s.openssl)
            ]
        };
    }
};
// ---------------------------------------------------------------------------
// Devices & networking
// ---------------------------------------------------------------------------
const devices = {
    id: "mobile.devices",
    command: "deviceCommands",
    title: "adb & simctl Command Builder",
    summary: "Ready-to-run adb, xcrun simctl and devicectl commands for your app: install, launch, clear data, filtered logs, deep links, port reverse, proxy, permissions, screenshots, dark mode, push notifications and more.",
    keywords: ["adb", "simctl", "xcrun", "devicectl", "logcat", "adb reverse", "screenshot", "screenrecord", "emulator", "simulator", "push notification simulator", "clear app data"],
    icon: "terminal",
    live: true,
    fields: [
        helpers_1.f.select("platform", "Platform", (0, helpers_1.opts)(["android", "Android (adb)"], ["ios-sim", "iOS Simulator (simctl)"], ["ios-device", "iOS device (devicectl)"])),
        helpers_1.f.text("pkg", "Android package", { width: "narrow", default: "com.example.app", showIf: { field: "platform", equals: ["android"] } }),
        helpers_1.f.text("bundle", "iOS bundle ID", { width: "narrow", default: "com.example.app", showIf: { field: "platform", equals: ["ios-sim", "ios-device"] } }),
        helpers_1.f.text("serial", "Device serial (optional)", { width: "narrow", placeholder: "emulator-5554", showIf: { field: "platform", equals: ["android"] } }),
        helpers_1.f.text("apk", "APK path", { width: "narrow", default: "app/build/outputs/apk/debug/app-debug.apk", showIf: { field: "platform", equals: ["android"] } }),
        helpers_1.f.text("url", "Deep link", { width: "narrow", default: "https://example.com/products/42" }),
        helpers_1.f.num("port", "Dev server port", 3000, { min: 1, max: 65535 }),
        helpers_1.f.text("proxy", "Proxy host:port", { width: "narrow", default: "10.0.2.2:8888" }),
        helpers_1.f.text("filter", "Filter", { width: "narrow", placeholder: "logs, network, screen…" })
    ],
    run(values) {
        const platform = (0, types_1.str)(values, "platform", "android");
        const rows = (0, mobile_config_1.deviceCommands)(platform, { pkg: (0, types_1.str)(values, "pkg", "com.example.app").trim(), bundle: (0, types_1.str)(values, "bundle", "com.example.app").trim(), url: (0, types_1.str)(values, "url").trim() || "myapp://home", port: (0, types_1.num)(values, "port", 3000, { min: 1, max: 65535, integer: true }), serial: (0, types_1.str)(values, "serial"), proxy: (0, types_1.str)(values, "proxy", "10.0.2.2:8888").trim(), apk: (0, types_1.str)(values, "apk", "app-debug.apk").trim() });
        const filter = (0, types_1.str)(values, "filter").trim().toLowerCase();
        const shown = filter ? rows.filter(r => r.join(" ").toLowerCase().includes(filter)) : rows;
        if (!shown.length)
            throw new types_1.ToolInputError(`No commands match "${filter}".`);
        const groups = [...new Set(shown.map(r => r[0]))];
        return { stats: [{ label: "Commands", value: String(shown.length) }], outputs: groups.map(g => (0, helpers_1.code)(g, "shell", shown.filter(r => r[0] === g).map(r => `# ${r[1]}\n${r[2]}`).join("\n\n"))) };
    }
};
function lanAddress() {
    try {
        for (const addrs of Object.values((0, os_1.networkInterfaces)()))
            for (const a of addrs ?? [])
                if (a.family === "IPv4" && !a.internal && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(a.address))
                    return a.address;
    }
    catch { /* not available */ }
    return "";
}
const localApi = {
    id: "mobile.local-api",
    command: "mobileLocalApi",
    title: "Local API Access from Devices",
    summary: "Call the API running on your computer from an Android emulator, iOS simulator or physical phone: the right base URL for each, adb reverse, cleartext/ATS config for debug builds, server binding, proxy and per-platform base-URL code.",
    guide: "\"Network request failed\" from an emulator usually means the app called localhost - which is the emulator itself - or the server only listens on 127.0.0.1. Your LAN address is detected locally (it is never sent anywhere).",
    keywords: ["10.0.2.2", "localhost emulator", "network request failed", "adb reverse", "cleartext", "app transport security", "ats", "local network", "ngrok", "charles proxy", "proxyman"],
    icon: "network",
    fields: [
        helpers_1.f.num("port", "API port", 3000, { min: 1, max: 65535 }),
        helpers_1.f.text("lanIp", "Your LAN IP (auto-detected)", { width: "narrow", placeholder: "192.168.1.20" }),
        helpers_1.f.select("framework", "App framework", FRAMEWORKS),
        helpers_1.f.toggle("https", "Dev server uses HTTPS", false)
    ],
    run(values) {
        const ip = (0, types_1.str)(values, "lanIp").trim() || lanAddress();
        const r = (0, mobile_config_1.localApiAccess)((0, types_1.num)(values, "port", 3000, { min: 1, max: 65535, integer: true, label: "Port" }), ip, (0, types_1.bool)(values, "https"), (0, types_1.str)(values, "framework", "react-native"));
        return { messages: r.notes.map(t => ({ kind: "info", text: t })), outputs: [(0, helpers_1.table)("Base URL by target", ["Target", "Base URL", "Notes"], r.rows), ...r.outputs.map(o => (0, helpers_1.code)(o.title, o.language, o.content, o.fileName))], ...(ip && !(0, types_1.str)(values, "lanIp").trim() ? { setValues: { lanIp: ip } } : {}) };
    }
};
// ---------------------------------------------------------------------------
// Build & release
// ---------------------------------------------------------------------------
const SAMPLE_LOG = `FAILURE: Build failed with an exception.

* What went wrong:
A problem occurred configuring project ':app'.
> Unsupported class file major version 65

* Try:
> Run with --stacktrace option to get the stack trace.

[!] CocoaPods could not find compatible versions for pod "Firebase/CoreOnly"
error Unable to resolve module @react-navigation/native from App.tsx`;
const buildErrors = {
    id: "mobile.build-errors",
    command: "buildErrorExplainer",
    title: "Build Error Explainer",
    summary: "Paste a failing build log - Gradle, Xcode, CocoaPods, Metro, Expo/EAS, Flutter, npm, Next.js, TypeScript or Docker - and get the likely cause and the exact fix for each known error.",
    guide: "The explainer matches over 50 of the errors developers hit most. Everything runs locally; logs are not uploaded. For unknown errors it surfaces the first error lines, which is where the real cause almost always is.",
    keywords: ["build failed", "gradle error", "xcode error", "pod install", "cocoapods", "metro", "unable to resolve module", "flutter build", "eresolve", "hydration failed", "unsupported class file major version", "namespace not specified"],
    icon: "activity",
    live: true,
    fields: [helpers_1.f.code("log", "Build log", "log", { rows: 14, required: true, fromEditor: true, default: SAMPLE_LOG })],
    run(values) {
        const log = (0, types_1.required)(values, "log", "Build log");
        const found = (0, mobile_build_1.explainBuildLog)(log);
        const messages = found.length ? found.map(x => ({ kind: "warning", text: `Line ${x.lineNo} · ${x.error.platform}: ${x.error.title}` })) : [{ kind: "info", text: "No known error pattern matched. The first error lines are below - search for the first one, not the last (later errors are usually consequences)." }];
        const first = (0, mobile_build_1.firstErrorLines)(log);
        return {
            stats: [{ label: "Known problems", value: String(found.length), tone: found.length ? "warn" : "neutral" }, { label: "Log lines", value: String(log.split(/\r?\n/).length) }],
            messages,
            outputs: [
                ...(found.length ? [(0, helpers_1.table)("Causes and fixes", ["Problem", "Cause", "Fix"], found.map(x => [`${x.error.title}\n(${x.error.platform}, line ${x.lineNo})`, x.error.cause, x.error.fix]))] : []),
                ...(first.length ? [(0, helpers_1.code)("First error lines", "log", first.join("\n"))] : []),
                (0, helpers_1.text)("Universal reset (when all else fails)", "Android: cd android && ./gradlew clean && rm -rf ~/.gradle/caches/transforms-* .gradle build\niOS: rm -rf ~/Library/Developer/Xcode/DerivedData && cd ios && rm -rf Pods Podfile.lock && pod install --repo-update\nReact Native: watchman watch-del-all; rm -rf node_modules && npm install; npx react-native start --reset-cache\nExpo: npx expo start -c; npx expo prebuild --clean\nFlutter: flutter clean && flutter pub get && (cd ios && pod install)")
            ]
        };
    }
};
const versionsTool = {
    id: "mobile.versions",
    command: "sdkVersions",
    title: "SDK & Build Compatibility",
    summary: "Check AGP, Gradle, JDK, Kotlin and SDK levels against each other and Google Play's target API rule (paste your Gradle files), and look up Android API levels, Xcode/iOS/Swift, Flutter/Dart and React Native/Expo versions.",
    guide: "Tables reflect releases up to late 2025; newer versions may exist. Google raises Play's target API requirement every August; Apple requires the latest Xcode SDK for uploads each spring.",
    keywords: ["agp", "android gradle plugin", "gradle version", "jdk", "java version", "compileSdk", "targetSdk", "minSdk", "api level", "xcode version", "swift version", "flutter version", "dart version", "react native version", "expo sdk"],
    icon: "layers",
    live: true,
    fields: [
        helpers_1.f.select("mode", "Tool", (0, helpers_1.opts)(["android-check", "Check my Android toolchain"], ["android", "Android API levels"], ["ios", "Xcode / iOS / Swift"], ["flutter", "Flutter / Dart"], ["react-native", "React Native / Expo"], ["agp", "AGP ↔ Gradle ↔ JDK table"])),
        helpers_1.f.code("gradle", "Gradle files (paste any of them)", "groovy", { rows: 10, fromEditor: true, default: 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.4-bin.zip\nplugins {\n  id "com.android.application" version "8.7.3" apply false\n  id "org.jetbrains.kotlin.android" version "2.0.21" apply false\n}\nandroid {\n  compileSdk = 35\n  defaultConfig { minSdk = 24; targetSdk = 34 }\n}', showIf: { field: "mode", equals: ["android-check"] } }),
        helpers_1.f.num("jdk", "JDK running Gradle", 21, { min: 8, max: 30, showIf: { field: "mode", equals: ["android-check"] } })
    ],
    run(values) {
        const mode = (0, types_1.str)(values, "mode", "android-check");
        if (mode === "android")
            return { outputs: [(0, helpers_1.table)("Android API levels", ["API", "Version", "Codename", "Year", "What changes for developers"], mobile_build_1.ANDROID_LEVELS.map(r => [r[0], r[1], r[2], r[3], r[4]]))], messages: [{ kind: "info", text: "Google Play: new apps and updates must target API 35 since 31 Aug 2025. Apps targeting 35+ must support 16 KB memory pages (since 1 Nov 2025)." }] };
        if (mode === "ios")
            return { outputs: [(0, helpers_1.table)("Xcode / iOS / Swift", ["Xcode", "SDK", "Swift", "Requires", "Notes"], mobile_build_1.XCODE_MATRIX)] };
        if (mode === "flutter")
            return { outputs: [(0, helpers_1.table)("Flutter / Dart", ["Flutter", "Dart", "Released"], mobile_build_1.FLUTTER_MATRIX)], messages: [{ kind: "info", text: "Pin the version per project with FVM or the flutter-version field in CI, and keep pubspec's environment.sdk constraint in step." }] };
        if (mode === "react-native")
            return { outputs: [(0, helpers_1.table)("React Native / React / Expo", ["React Native", "React", "Expo SDK", "Notes"], mobile_build_1.RN_MATRIX)], messages: [{ kind: "info", text: "Upgrade one minor version at a time with the React Native Upgrade Helper (react-native-community.github.io/upgrade-helper) or npx expo install --fix." }] };
        if (mode === "agp")
            return { outputs: [(0, helpers_1.table)("Android Gradle Plugin", ["AGP", "Min Gradle", "JDK", "Max compileSdk"], mobile_build_1.AGP_MATRIX.map(r => [r.agp, r.gradle, r.jdk, r.maxApi]))] };
        const detected = (0, mobile_build_1.detectVersions)((0, types_1.str)(values, "gradle"));
        const checks = (0, mobile_build_1.checkAndroidToolchain)({ ...detected, runtimeJdk: (0, types_1.num)(values, "jdk", 17, { min: 8, max: 30, integer: true }) });
        const tone = (s) => s === "success" ? "success" : s === "error" ? "error" : s === "warning" ? "warning" : "info";
        return {
            stats: [{ label: "AGP", value: detected.agp ?? "?" }, { label: "Gradle", value: detected.gradle ?? "?" }, { label: "Kotlin", value: detected.kotlin ?? "?" }, { label: "SDK min / target / compile", value: `${detected.minSdk ?? "?"} / ${detected.targetSdk ?? "?"} / ${detected.compileSdk ?? "?"}` }],
            messages: checks.map(c => ({ kind: tone(c.severity), text: c.text })),
            outputs: []
        };
    }
};
const ci = {
    id: "mobile.ci",
    command: "mobileCiGenerator",
    title: "Mobile CI Workflow",
    summary: "GitHub Actions for Flutter, Android, iOS, React Native or Expo: lint and tests on every PR, signed release builds on main, and optional upload to Google Play (internal track) and TestFlight - with the list of secrets to add.",
    keywords: ["github actions", "mobile ci", "flutter ci", "android ci", "ios ci", "fastlane", "testflight", "google play upload", "eas build", "codemagic", "bitrise"],
    icon: "workflow",
    fields: [
        helpers_1.f.select("stack", "Stack", (0, helpers_1.opts)(["flutter", "Flutter"], ["react-native", "React Native (bare)"], ["expo", "Expo (EAS)"], ["android", "Android (Gradle)"], ["ios", "iOS (Xcode)"])),
        helpers_1.f.text("branch", "Release branch", { width: "narrow", default: "main" }),
        helpers_1.f.toggle("tests", "Run tests", true),
        helpers_1.f.toggle("release", "Build signed releases", true),
        helpers_1.f.toggle("deploy", "Upload to Play / TestFlight", false, { showIf: { field: "release", equals: [true] } }),
        helpers_1.f.text("flutter", "Flutter version", { width: "narrow", default: "3.35.x", showIf: { field: "stack", equals: ["flutter"] } }),
        helpers_1.f.text("node", "Node version", { width: "narrow", default: "22", showIf: { field: "stack", equals: ["react-native", "expo"] } }),
        helpers_1.f.select("packageManager", "Package manager", (0, helpers_1.opts)("npm", "yarn", "pnpm"), { showIf: { field: "stack", equals: ["react-native", "expo"] } }),
        helpers_1.f.text("java", "Java version", { width: "narrow", default: "17", showIf: { field: "stack", equals: ["flutter", "android", "react-native"] } }),
        helpers_1.f.text("scheme", "Xcode scheme / workspace", { width: "narrow", default: "App", showIf: { field: "stack", equals: ["ios", "react-native"] } })
    ],
    run(values) {
        const r = (0, mobile_build_1.mobileCi)({ stack: (0, types_1.str)(values, "stack", "flutter"), branch: (0, types_1.str)(values, "branch", "main").trim() || "main", tests: (0, types_1.bool)(values, "tests", true), release: (0, types_1.bool)(values, "release", true), deploy: (0, types_1.bool)(values, "deploy"), node: (0, types_1.str)(values, "node", "22"), java: (0, types_1.str)(values, "java", "17"), flutter: (0, types_1.str)(values, "flutter", "3.35.x"), scheme: (0, types_1.str)(values, "scheme", "App"), packageManager: (0, types_1.str)(values, "packageManager", "npm") });
        const messages = [{ kind: "info", text: "Replace com.example.app and TEAMID1234 with your IDs. Release jobs run only on pushes to the release branch; PRs run lint and tests." }];
        if ((0, types_1.str)(values, "stack", "flutter") === "ios" || (0, types_1.str)(values, "stack", "flutter") === "flutter" || (0, types_1.str)(values, "stack", "flutter") === "react-native")
            messages.push({ kind: "info", text: "macOS runners cost about 10× Linux minutes on GitHub; keep iOS jobs to release builds." });
        return { messages, outputs: [{ kind: "files", title: "Workflow", files: r.files }, ...(r.secrets.length ? [(0, helpers_1.table)("Repository secrets to add (Settings → Secrets and variables → Actions)", ["Secret", "Value"], r.secrets)] : [])] };
    }
};
// ---------------------------------------------------------------------------
// Converters
// ---------------------------------------------------------------------------
const colors = {
    id: "mobile.colors",
    command: "colorConverter",
    title: "Color Converter & Palette",
    summary: "Convert a colour between CSS hex/rgb/hsl, Tailwind, React Native, Android XML (#AARRGGBB), Jetpack Compose, Flutter Color(0xAARRGGBB), SwiftUI and UIKit; check WCAG contrast; generate a 50-950 shade palette.",
    guide: "8-digit hex is ambiguous: CSS uses #RRGGBBAA, Android and Flutter use AARRGGBB. Choose how to read it below. 0x… and Color(0x…) values are always read as AARRGGBB.",
    aliases: [{ command: "colorPalette", values: {} }],
    keywords: ["color converter", "color palette", "shades", "hex to rgb", "argb", "flutter color", "compose color", "swiftui color", "uicolor", "android color", "contrast ratio", "wcag", "tailwind color"],
    icon: "palette",
    live: true,
    fields: [
        helpers_1.f.text("color", "Colour", { required: true, default: "#1E88E5" }),
        helpers_1.f.select("eight", "8-digit hex means", (0, helpers_1.opts)(["css", "#RRGGBBAA (CSS)"], ["argb", "#AARRGGBB (Android / Flutter)"])),
        helpers_1.f.text("background", "Contrast against", { width: "narrow", default: "#FFFFFF" })
    ],
    examples: [
        { label: "Flutter Color with alpha", values: { color: "Color(0x991E88E5)" } },
        { label: "Android #AARRGGBB", values: { color: "#CC000000", eight: "argb" } },
        { label: "CSS hsl()", values: { color: "hsl(262 83% 58%)" } },
        { label: "SwiftUI", values: { color: "Color(red: 0.2, green: 0.6, blue: 0.86)" } }
    ],
    run(values) {
        const eight = (0, types_1.str)(values, "eight", "css");
        const c = (0, mobile_config_1.parseColor)((0, types_1.required)(values, "color", "Colour"), eight);
        const bgText = (0, types_1.str)(values, "background").trim();
        const bg = bgText ? (0, mobile_config_1.parseColor)(bgText, eight) : { r: 255, g: 255, b: 255, a: 1 };
        const ratio = (0, mobile_config_1.contrastRatio)(c, bg);
        const level = (min) => (ratio >= min ? "pass" : "fail");
        const messages = [];
        if (c.a < 1)
            messages.push({ kind: "info", text: `Alpha ${(c.a * 100).toFixed(1)}%: contrast is computed for the opaque colour; on screen it blends with what is behind it.` });
        return {
            stats: [{ label: "Contrast", value: `${ratio.toFixed(2)}:1`, tone: ratio >= 4.5 ? "good" : ratio >= 3 ? "warn" : "bad" }, { label: "Text AA", value: level(4.5), tone: ratio >= 4.5 ? "good" : "bad" }, { label: "Large text AA", value: level(3), tone: ratio >= 3 ? "good" : "bad" }, { label: "AAA", value: level(7), tone: ratio >= 7 ? "good" : "neutral" }],
            messages,
            outputs: [(0, helpers_1.table)("Formats", ["Platform", "Value"], (0, mobile_config_1.colorFormats)(c)), (0, helpers_1.table)("Shades (same hue)", ["Step", "Hex"], (0, mobile_config_1.shades)(c)), (0, helpers_1.code)("Tailwind v4 theme", "css", `@theme {\n${(0, mobile_config_1.shades)(c).map(([k, v]) => `  --color-brand-${k}: ${v};`).join("\n")}\n}\n`)]
        };
    }
};
const density = {
    id: "mobile.density",
    command: "densityConverter",
    title: "dp / px / pt Converter & Asset Sizes",
    summary: "Convert between dp, sp, px and pt across Android densities (mdpi-xxxhdpi), iOS @1x-@3x, web and Flutter/React Native logical pixels - plus a reference of app icon, splash, store and screenshot sizes.",
    keywords: ["dp to px", "px to dp", "sp", "pt", "density", "xxhdpi", "@2x", "@3x", "app icon size", "adaptive icon", "splash screen size", "screenshot size", "play store icon"],
    icon: "grid",
    live: true,
    fields: [
        helpers_1.f.select("mode", "Tool", (0, helpers_1.opts)(["convert", "Convert a size"], ["assets", "Icon, splash and store sizes"])),
        helpers_1.f.num("value", "Value", 48, { showIf: { field: "mode", equals: ["convert"] } }),
        helpers_1.f.select("unit", "Unit", (0, helpers_1.opts)(["dp", "dp / pt / logical px"], ["px", "px (physical)"], ["sp", "sp (text)"]), { showIf: { field: "mode", equals: ["convert"] } }),
        helpers_1.f.select("density", "px measured at", (0, helpers_1.opts)(["3", "xxhdpi / @3x (3×)"], ["2", "xhdpi / @2x (2×)"], ["4", "xxxhdpi (4×)"], ["1.5", "hdpi (1.5×)"], ["1", "mdpi / @1x (1×)"]), { showIf: { field: "unit", equals: ["px"] } }),
        helpers_1.f.num("fontScale", "User font scale", 1, { min: 0.5, max: 3, step: 0.05, showIf: { field: "unit", equals: ["sp"] } })
    ],
    run(values) {
        if ((0, types_1.str)(values, "mode", "convert") === "assets")
            return { outputs: [(0, helpers_1.table)("Sizes", ["Asset", "Size", "Details"], mobile_config_1.ASSET_SIZES)] };
        const unit = (0, types_1.str)(values, "unit", "dp");
        const rows = (0, mobile_config_1.densityTable)((0, types_1.num)(values, "value", 48), unit, Number((0, types_1.str)(values, "density", "3")), (0, types_1.num)(values, "fontScale", 1, { min: 0.5, max: 3 }));
        return { messages: [{ kind: "info", text: "1 dp = 1 px at 160 dpi (mdpi). Use sp for text so it follows the user's font size; Flutter and React Native sizes are already logical pixels (= dp / pt)." }], outputs: [(0, helpers_1.table)("Sizes", ["Target", "Pixels", "Logical"], rows)] };
    }
};
exports.MOBILE_TOOLS = [deepLinks, permissions, flavors, signing, certificates, devices, localApi, buildErrors, versionsTool, ci, colors, density];
//# sourceMappingURL=mobile.js.map