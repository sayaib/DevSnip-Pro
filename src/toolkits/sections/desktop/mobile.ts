import { networkInterfaces } from "os";
import { ToolSpec, ToolResult, bool, num, required, str } from "../../types";
import { MobileFramework, localApiAccess } from "../../engines/mobile-config";
import { parseCertificates, pinningSnippets } from "../../engines/mobile-build";
import { code, f, opts, table } from "../helpers";
import { SAMPLE_CERT } from "../mobile";
type Messages = NonNullable<ToolResult["messages"]>;
const FRAMEWORKS = opts(["react-native", "React Native (bare)"], ["expo", "Expo"], ["flutter", "Flutter"], ["native", "Native Android + iOS"]);
const certificates: ToolSpec = {
  id: "mobile.certificates",
  command: "certInspector",
  title: "Certificate & SSL Pinning Inspector",
  summary: "Decode PEM certificates locally: subject, issuer, SANs, validity, key type, SHA-1/SHA-256 fingerprints and the SPKI pin - then get OkHttp, Android network security config and iOS NSPinnedDomains pinning config.",
  guide: "Pin the public key (SPKI), not the certificate, and always include a backup pin (e.g. the intermediate CA or a pre-generated spare key). A pin that no longer matches bricks networking for every installed app until users update.",
  keywords: ["certificate", "x509", "pem", "ssl", "tls", "pinning", "spki", "fingerprint", "openssl", "network security config", "certificatepinner", "NSPinnedDomains"],
  icon: "fingerprint",
  live: true,
  examples: [{ label: "Sample self-signed certificate", values: { pem: SAMPLE_CERT, host: "api.example.com" } }],
  fields: [
    f.code("pem", "Certificate(s) (PEM)", "text", { rows: 12, required: true, fromEditor: true, placeholder: "-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----" }),
    f.text("host", "Host to pin", { width: "narrow", default: "api.example.com" }),
    f.text("expiry", "Pin-set expiration", { width: "narrow", default: "2027-12-31", help: "Android stops enforcing pins after this date (a safety valve)." })
  ],
  run(values, ctx) {
    const certs = parseCertificates(required(values, "pem", "Certificate"), ctx.now?.() ?? new Date());
    const messages: Messages = [];
    for (const [i, c] of certs.entries()) {
      const label = `Certificate ${i + 1} (${c.subject.split(", ").find(p => p.startsWith("CN="))?.slice(3) ?? c.subject.slice(0, 40)})`;
      if (c.daysLeft < 0) messages.push({ kind: "error", text: `${label} expired ${-c.daysLeft} days ago.` });
      else if (c.daysLeft < 30) messages.push({ kind: "warning", text: `${label} expires in ${c.daysLeft} days.` });
      if (c.selfSigned && !c.ca) messages.push({ kind: "warning", text: `${label} is self-signed: devices reject it unless its CA is installed and trusted.` });
      if (/RSA (512|1024)-bit/.test(c.keyType)) messages.push({ kind: "error", text: `${label} uses a weak ${c.keyType} key.` });
    }
    const pins = [...new Set(certs.map(c => c.spkiPin))];
    if (pins.length < 2) messages.push({ kind: "warning", text: "Only one pin: add a backup (the intermediate certificate's pin, or a spare key you have not deployed yet) before shipping." });
    const s = pinningSnippets(str(values, "host", "api.example.com").trim(), pins, str(values, "expiry", "2027-12-31").trim());
    return {
      stats: [{ label: "Certificates", value: String(certs.length) }, { label: "Leaf expires", value: `${certs[0].daysLeft} days`, tone: certs[0].daysLeft < 0 ? "bad" : certs[0].daysLeft < 30 ? "warn" : "good" }],
      messages,
      outputs: [
        table("Certificates", ["#", "Subject", "Issuer", "Valid until", "Key", "SANs"], certs.map((c, i) => [i + 1, c.subject, c.issuer, c.validTo.toISOString().slice(0, 10), c.keyType, c.sans.slice(0, 6).join(", ") + (c.sans.length > 6 ? ` (+${c.sans.length - 6})` : "")])),
        table("Fingerprints and pins", ["#", "SHA-256 fingerprint", "SHA-1 fingerprint", "SPKI pin (sha256/…)"], certs.map((c, i) => [i + 1, c.sha256, c.sha1, c.spkiPin])),
        code("OkHttp (Android / Kotlin)", "kotlin", s.okhttp),
        code("Android network_security_config.xml", "xml", s.android, "android/app/src/main/res/xml/network_security_config.xml"),
        code("iOS Info.plist", "xml", s.ios),
        code("openssl", "shell", s.openssl)
      ]
    };
  }
};

function lanAddress(): string {
  try {
    for (const addrs of Object.values(networkInterfaces())) for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(a.address)) return a.address;
  } catch { /* not available */ }
  return "";
}

const localApi: ToolSpec = {
  id: "mobile.local-api",
  command: "mobileLocalApi",
  title: "Local API Access from Devices",
  summary: "Call the API running on your computer from an Android emulator, iOS simulator or physical phone: the right base URL for each, adb reverse, cleartext/ATS config for debug builds, server binding, proxy and per-platform base-URL code.",
  guide: "\"Network request failed\" from an emulator usually means the app called localhost - which is the emulator itself - or the server only listens on 127.0.0.1. Your LAN address is detected locally (it is never sent anywhere).",
  keywords: ["10.0.2.2", "localhost emulator", "network request failed", "adb reverse", "cleartext", "app transport security", "ats", "local network", "ngrok", "charles proxy", "proxyman"],
  icon: "network",
  fields: [
    f.num("port", "API port", 3000, { min: 1, max: 65535 }),
    f.text("lanIp", "Your LAN IP (auto-detected)", { width: "narrow", placeholder: "192.168.1.20" }),
    f.select("framework", "App framework", FRAMEWORKS),
    f.toggle("https", "Dev server uses HTTPS", false)
  ],
  run(values) {
    const ip = str(values, "lanIp").trim() || lanAddress();
    const r = localApiAccess(num(values, "port", 3000, { min: 1, max: 65535, integer: true, label: "Port" }), ip, bool(values, "https"), str(values, "framework", "react-native") as MobileFramework);
    return { messages: r.notes.map(t => ({ kind: "info" as const, text: t })), outputs: [table("Base URL by target", ["Target", "Base URL", "Notes"], r.rows), ...r.outputs.map(o => code(o.title, o.language, o.content, o.fileName))], ...(ip && !str(values, "lanIp").trim() ? { setValues: { lanIp: ip } } : {}) };
  }
};
export const DESKTOP_MOBILE_TOOLS: ToolSpec[] = [certificates, localApi];
