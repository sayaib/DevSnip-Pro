"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESKTOP_DEV_TOOLS = void 0;
const types_1 = require("../../types");
const web_auth_1 = require("../../engines/web-auth");
const helpers_1 = require("../helpers");
const SAMPLE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
const jwtTool = {
    id: "dev.jwt",
    command: "jwtDecoder",
    title: "JWT Decoder & Signer",
    summary: "Decode a JSON Web Token locally (claims with readable dates, expiry, security warnings), verify its signature with a secret, PEM public key or JWK - or sign test tokens with HS/RS/PS/ES/EdDSA.",
    guide: "Everything happens on your machine; tokens and keys are never sent anywhere. HS* tokens verify with the shared secret; RS/PS/ES/EdDSA tokens verify with the issuer's public key (PEM, certificate or a JWK from its jwks.json). Signing is for local testing - never paste production private keys into tools.",
    keywords: ["jwt", "json web token", "bearer", "claims", "exp", "oauth", "id token", "decode token", "sign jwt", "verify jwt", "jwks", "rs256", "hs256"],
    icon: "key",
    live: true,
    examples: [
        { label: "Sample HS256 token (secret: your-256-bit-secret)", values: { mode: "decode", token: SAMPLE_JWT, secret: "your-256-bit-secret" } },
        { label: "Sign a test token (HS256)", values: { mode: "sign", alg: "HS256", payload: '{\n  "sub": "user_123",\n  "role": "admin",\n  "aud": "https://api.example.com"\n}', expiresIn: 60, secret: "dev-secret-at-least-32-bytes-long!!" } }
    ],
    fields: [
        helpers_1.f.select("mode", "Mode", (0, helpers_1.opts)(["decode", "Decode & verify"], ["sign", "Sign a test token"])),
        helpers_1.f.area("token", "Token", { rows: 5, required: true, fromEditor: true, placeholder: "eyJhbGciOi... (a leading \"Bearer \" is fine)", showIf: { field: "mode", equals: ["decode"] } }),
        helpers_1.f.select("alg", "Algorithm", web_auth_1.JWT_ALGS.map(a => ({ value: a, label: a })), { showIf: { field: "mode", equals: ["sign"] } }),
        helpers_1.f.code("payload", "Payload (JSON)", "json", { rows: 7, default: '{\n  "sub": "user_123",\n  "name": "Ada Lovelace",\n  "role": "admin"\n}', showIf: { field: "mode", equals: ["sign"] } }),
        helpers_1.f.num("expiresIn", "Expires in (minutes, 0 = never)", 60, { min: 0, max: 5256000, showIf: { field: "mode", equals: ["sign"] } }),
        helpers_1.f.toggle("iat", "Add iat (issued at)", true, { showIf: { field: "mode", equals: ["sign"] } }),
        helpers_1.f.text("kid", "Key id (kid, optional)", { width: "narrow", showIf: { field: "mode", equals: ["sign"] } }),
        helpers_1.f.secret("secret", "Secret, PEM key or JWK", { placeholder: "HS*: shared secret · RS/ES/PS: public key to verify, private key to sign" })
    ],
    async run(values, ctx) {
        const now = (ctx.now?.() ?? new Date()).getTime();
        if ((0, types_1.str)(values, "mode", "decode") === "sign") {
            let payload;
            try {
                payload = JSON.parse((0, types_1.str)(values, "payload") || "{}");
            }
            catch (e) {
                throw new types_1.ToolInputError(`The payload is not valid JSON: ${e.message}`);
            }
            if (!payload || typeof payload !== "object" || Array.isArray(payload))
                throw new types_1.ToolInputError("The payload must be a JSON object.");
            const seconds = Math.floor(now / 1000);
            if ((0, types_1.bool)(values, "iat", true) && payload.iat === undefined)
                payload.iat = seconds;
            const minutes = (0, types_1.num)(values, "expiresIn", 60, { min: 0, integer: true, label: "Expires in" });
            if (minutes > 0 && payload.exp === undefined)
                payload.exp = seconds + minutes * 60;
            const alg = (0, types_1.str)(values, "alg", "HS256");
            const header = { alg, typ: "JWT", ...((0, types_1.str)(values, "kid").trim() ? { kid: (0, types_1.str)(values, "kid").trim() } : {}) };
            const token = (0, web_auth_1.signJwt)(header, payload, (0, types_1.str)(values, "secret"));
            return {
                stats: [{ label: "Algorithm", value: alg }, { label: "Expires", value: payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : "never", tone: payload.exp ? "good" : "warn" }, { label: "Length", value: `${token.length} chars` }],
                messages: [{ kind: "info", text: "Test tokens only. Real tokens should come from your auth server with short expiry, audience (aud) and issuer (iss) claims." }],
                outputs: [(0, helpers_1.code)("Token", "text", token), (0, helpers_1.code)("Header", "json", JSON.stringify(header, null, 2)), (0, helpers_1.code)("Payload", "json", JSON.stringify(payload, null, 2)), (0, helpers_1.code)("Use it", "shell", `curl -H "Authorization: Bearer ${token}" https://api.example.com/me`)]
            };
        }
        const token = (0, types_1.str)(values, "token").trim().replace(/^Bearer\s+/i, "");
        if (!token)
            throw new types_1.ToolInputError("Paste a JWT.");
        const { inspectJwt } = await Promise.resolve().then(() => __importStar(require("../../../services/dev-operations")));
        const r = inspectJwt(token);
        if (!r.valid || !r.header || !r.payload)
            throw new types_1.ToolInputError(r.error ?? "This is not a valid JWT.");
        const claims = Object.entries(r.payload).map(([k, v]) => {
            const isTime = ["exp", "iat", "nbf", "auth_time", "updated_at"].includes(k) && typeof v === "number";
            const detail = isTime ? `${new Date(v * 1000).toISOString()} (${relative(v * 1000 - now)})` : CLAIM_MEANINGS[k] ?? "";
            return [k, typeof v === "object" ? JSON.stringify(v) : String(v), detail];
        });
        const stats = [
            { label: "Algorithm", value: String(r.header.alg ?? "?"), tone: String(r.header.alg).toLowerCase() === "none" ? "bad" : "neutral" },
            { label: "Status", value: r.expired ? "expired" : r.expiresAt ? "not expired" : "no expiry", tone: r.expired ? "bad" : r.expiresAt ? "good" : "warn" }
        ];
        const messages = r.warnings.map(w => ({ kind: "warning", text: w }));
        const secret = (0, types_1.str)(values, "secret");
        if (secret) {
            try {
                const v = (0, web_auth_1.verifyJwtSignature)(token, secret);
                if (v.note)
                    messages.unshift({ kind: v.ok ? "info" : "warning", text: v.note });
                else {
                    stats.push({ label: "Signature", value: v.ok ? "valid" : "INVALID", tone: v.ok ? "good" : "bad" });
                    messages.unshift(v.ok ? { kind: "success", text: `The signature matches this ${(0, web_auth_1.isKeyMaterial)(secret) ? "key" : "secret"}.` } : { kind: "error", text: `The signature does not match this ${(0, web_auth_1.isKeyMaterial)(secret) ? "key" : "secret"}: the token was altered or signed with a different key.` });
                }
            }
            catch (error) {
                if (error instanceof types_1.ToolInputError)
                    messages.unshift({ kind: "error", text: error.message });
                else
                    throw error;
            }
        }
        else {
            messages.push({ kind: "info", text: "The signature was not verified. Decoding a token does not prove it is genuine - add the secret or public key." });
        }
        return {
            stats,
            messages,
            outputs: [
                (0, helpers_1.table)("Claims", ["Claim", "Value", "Meaning"], claims),
                (0, helpers_1.code)("Header", "json", JSON.stringify(r.header, null, 2)),
                (0, helpers_1.code)("Payload", "json", JSON.stringify(r.payload, null, 2))
            ]
        };
    }
};
const CLAIM_MEANINGS = { iss: "Issuer", sub: "Subject (user id)", aud: "Audience - the API this token is for", jti: "Token id (for revocation / replay checks)", azp: "Authorized party (client id)", scope: "Granted scopes", scp: "Granted scopes", roles: "Roles", email: "Email", email_verified: "Email verified by the issuer", sid: "Session id", nonce: "Must match the nonce sent in the auth request", at_hash: "Access token hash (OIDC)", tid: "Tenant id (Entra ID)", client_id: "Client id" };
function relative(ms) {
    const abs = Math.abs(ms);
    const unit = abs >= 86400000 ? [86400000, "day"] : abs >= 3600000 ? [3600000, "hour"] : abs >= 60000 ? [60000, "minute"] : [1000, "second"];
    const n = Math.round(abs / unit[0]);
    return ms >= 0 ? `in ${n} ${unit[1]}${n === 1 ? "" : "s"}` : `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
}
const hashTool = {
    id: "dev.hash",
    command: "hashGenerator",
    title: "Hash, HMAC & Webhook Signatures",
    summary: "MD5, SHA-1, SHA-2 and SHA-3 hashes in hex and Base64; HMAC with any secret; and verify webhook signatures from GitHub, Stripe, Shopify, Slack or any HMAC-SHA256 sender.",
    guide: "Webhook signatures are computed over the exact raw request body. If yours never matches, the framework probably parsed and re-serialised the JSON (express.json(), NestJS body parser) - verify against the raw bytes. MD5 and SHA-1 are fine for checksums, never for passwords or signatures.",
    keywords: ["hash", "sha256", "sha1", "md5", "sha512", "sha3", "checksum", "hmac", "webhook", "signature", "x-hub-signature", "stripe-signature", "shopify hmac", "slack signature"],
    icon: "hash",
    live: true,
    fields: [
        helpers_1.f.select("mode", "Tool", (0, helpers_1.opts)(["hash", "Hash"], ["hmac", "HMAC"], ["webhook", "Verify a webhook signature"])),
        helpers_1.f.area("input", "Input", { rows: 5, required: true, fromEditor: true, default: "Hello, DevSnip Pro!", showIf: { field: "mode", equals: ["hash", "hmac"] } }),
        helpers_1.f.select("encoding", "Input is", (0, helpers_1.opts)(["utf8", "Text (UTF-8)"], ["hex", "Hex bytes"], ["base64", "Base64 bytes"]), { showIf: { field: "mode", equals: ["hash", "hmac"] } }),
        helpers_1.f.select("algorithm", "HMAC algorithm", (0, helpers_1.opts)(["sha256", "SHA-256"], ["sha1", "SHA-1"], ["sha384", "SHA-384"], ["sha512", "SHA-512"], ["md5", "MD5"]), { showIf: { field: "mode", equals: ["hmac"] } }),
        helpers_1.f.select("provider", "Sender", (0, helpers_1.opts)(["github", "GitHub (X-Hub-Signature-256)"], ["stripe", "Stripe (Stripe-Signature)"], ["shopify", "Shopify (X-Shopify-Hmac-Sha256)"], ["slack", "Slack (X-Slack-Signature)"], ["generic-hex", "Generic HMAC-SHA256, hex"], ["generic-base64", "Generic HMAC-SHA256, Base64"]), { showIf: { field: "mode", equals: ["webhook"] } }),
        helpers_1.f.code("payload", "Raw request body", "json", { rows: 6, default: '{"action":"opened","number":42}', showIf: { field: "mode", equals: ["webhook"] } }),
        helpers_1.f.text("signature", "Signature header value", { default: "sha256=5f1d1b8ab0d2b4b8c1f2c4e3a8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9", showIf: { field: "mode", equals: ["webhook"] } }),
        helpers_1.f.text("timestamp", "Timestamp header (Slack / Stripe)", { width: "narrow", showIf: { field: "provider", equals: ["slack", "stripe"] } }),
        helpers_1.f.secret("secret", "Secret", { showIf: { field: "mode", equals: ["hmac", "webhook"] } })
    ],
    run(values, ctx) {
        const mode = (0, types_1.str)(values, "mode", "hash");
        if (mode === "webhook") {
            const secret = (0, types_1.str)(values, "secret");
            if (!secret)
                throw new types_1.ToolInputError("Enter the webhook signing secret.");
            const provider = (0, types_1.str)(values, "provider", "github");
            const r = (0, web_auth_1.verifyWebhook)({ provider, payload: (0, types_1.str)(values, "payload"), secret, signature: (0, types_1.str)(values, "signature"), timestamp: (0, types_1.str)(values, "timestamp"), now: ctx.now?.() ?? new Date() });
            const messages = r.notes.map(t => ({ kind: "warning", text: t }));
            if (r.match === true)
                messages.unshift({ kind: "success", text: "The signature is valid for this body and secret." });
            if (r.match === false)
                messages.unshift({ kind: "error", text: "The signature does NOT match. Check that you use the raw body (no re-serialised JSON, same whitespace and line endings) and the right secret for this endpoint." });
            if (/\n\s{2,}"/.test((0, types_1.str)(values, "payload")))
                messages.push({ kind: "info", text: "The body looks pretty-printed. Senders sign the compact body exactly as sent; copy it from the raw request log." });
            return {
                stats: [{ label: "Result", value: r.match === undefined ? "no signature given" : r.match ? "valid" : "INVALID", tone: r.match === undefined ? "neutral" : r.match ? "good" : "bad" }, { label: "Header", value: r.header }],
                messages,
                outputs: [(0, helpers_1.code)("Expected signature", "text", r.expected), (0, helpers_1.table)("How it is computed", ["Step", "Value"], [["Algorithm", "HMAC-SHA256"], ["Signed content", r.signedContent], ["Encoding", provider === "shopify" || provider === "generic-base64" ? "Base64" : "hex"]]), (0, helpers_1.code)("Express handler", "typescript", (0, web_auth_1.webhookHandler)(provider))]
            };
        }
        const input = (0, types_1.str)(values, "input");
        if (!input)
            throw new types_1.ToolInputError("Enter some input.");
        const encoding = (0, types_1.str)(values, "encoding", "utf8");
        if (mode === "hmac") {
            const secret = (0, types_1.str)(values, "secret");
            if (!secret)
                throw new types_1.ToolInputError("Enter the HMAC secret.");
            const algorithm = (0, types_1.str)(values, "algorithm", "sha256");
            const mac = (0, web_auth_1.hmac)(input, secret, algorithm, encoding);
            return { outputs: [(0, helpers_1.table)(`HMAC-${algorithm.toUpperCase()}`, ["Encoding", "Value"], [["hex", mac.toString("hex")], ["Base64", mac.toString("base64")], ["Base64URL", mac.toString("base64url")]]), (0, helpers_1.code)("Node.js", "javascript", `import crypto from "node:crypto";\n\nconst mac = crypto.createHmac(${JSON.stringify(algorithm)}, process.env.SECRET).update(body).digest("hex");\n// Compare with crypto.timingSafeEqual, never ===\n`)] };
        }
        const algs = (0, web_auth_1.availableHashes)();
        const rows = algs.map(a => { const d = (0, web_auth_1.digest)(input, a, encoding); return [a.toUpperCase(), d.toString("hex"), d.toString("base64")]; });
        return {
            stats: [{ label: "Input", value: `${(0, web_auth_1.toBytes)(input, encoding).length} bytes` }, { label: "Algorithms", value: String(rows.length) }],
            messages: [{ kind: "info", text: "Passwords need a slow, salted hash (bcrypt, scrypt, Argon2id) - not any of these." }],
            outputs: [(0, helpers_1.table)("Hashes", ["Algorithm", "Hex", "Base64"], rows), (0, helpers_1.code)("Verify a downloaded file", "shell", "shasum -a 256 file.zip          # macOS / Linux\ncertutil -hashfile file.zip SHA256   # Windows")]
        };
    }
};
exports.DESKTOP_DEV_TOOLS = [jwtTool, hashTool];
//# sourceMappingURL=dev.js.map