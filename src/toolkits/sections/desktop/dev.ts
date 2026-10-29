import { ToolSpec, ToolInputError, ToolResult, bool, num, str } from "../../types";

import { HashAlgorithm, JWT_ALGS, WebhookProvider, availableHashes, digest, hmac, isKeyMaterial, signJwt, toBytes, verifyJwtSignature, verifyWebhook, webhookHandler } from "../../engines/web-auth";

import { code, f, opts, table } from "../helpers";
const SAMPLE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

const jwtTool: ToolSpec = {
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
    f.select("mode", "Mode", opts(["decode", "Decode & verify"], ["sign", "Sign a test token"])),
    f.area("token", "Token", { rows: 5, required: true, fromEditor: true, placeholder: "eyJhbGciOi... (a leading \"Bearer \" is fine)", showIf: { field: "mode", equals: ["decode"] } }),
    f.select("alg", "Algorithm", JWT_ALGS.map(a => ({ value: a, label: a })), { showIf: { field: "mode", equals: ["sign"] } }),
    f.code("payload", "Payload (JSON)", "json", { rows: 7, default: '{\n  "sub": "user_123",\n  "name": "Ada Lovelace",\n  "role": "admin"\n}', showIf: { field: "mode", equals: ["sign"] } }),
    f.num("expiresIn", "Expires in (minutes, 0 = never)", 60, { min: 0, max: 5_256_000, showIf: { field: "mode", equals: ["sign"] } }),
    f.toggle("iat", "Add iat (issued at)", true, { showIf: { field: "mode", equals: ["sign"] } }),
    f.text("kid", "Key id (kid, optional)", { width: "narrow", showIf: { field: "mode", equals: ["sign"] } }),
    f.secret("secret", "Secret, PEM key or JWK", { placeholder: "HS*: shared secret · RS/ES/PS: public key to verify, private key to sign" })
  ],
  async run(values, ctx) {
    const now = (ctx.now?.() ?? new Date()).getTime();
    if (str(values, "mode", "decode") === "sign") {
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(str(values, "payload") || "{}"); } catch (e) { throw new ToolInputError(`The payload is not valid JSON: ${(e as Error).message}`); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ToolInputError("The payload must be a JSON object.");
      const seconds = Math.floor(now / 1000);
      if (bool(values, "iat", true) && payload.iat === undefined) payload.iat = seconds;
      const minutes = num(values, "expiresIn", 60, { min: 0, integer: true, label: "Expires in" });
      if (minutes > 0 && payload.exp === undefined) payload.exp = seconds + minutes * 60;
      const alg = str(values, "alg", "HS256");
      const header: Record<string, unknown> = { alg, typ: "JWT", ...(str(values, "kid").trim() ? { kid: str(values, "kid").trim() } : {}) };
      const token = signJwt(header, payload, str(values, "secret"));
      return {
        stats: [{ label: "Algorithm", value: alg }, { label: "Expires", value: payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : "never", tone: payload.exp ? "good" : "warn" }, { label: "Length", value: `${token.length} chars` }],
        messages: [{ kind: "info", text: "Test tokens only. Real tokens should come from your auth server with short expiry, audience (aud) and issuer (iss) claims." }],
        outputs: [code("Token", "text", token), code("Header", "json", JSON.stringify(header, null, 2)), code("Payload", "json", JSON.stringify(payload, null, 2)), code("Use it", "shell", `curl -H "Authorization: Bearer ${token}" https://api.example.com/me`)]
      };
    }
    const token = str(values, "token").trim().replace(/^Bearer\s+/i, "");
    if (!token) throw new ToolInputError("Paste a JWT.");
    const { inspectJwt } = await import("../../../services/dev-operations");
    const r = inspectJwt(token);
    if (!r.valid || !r.header || !r.payload) throw new ToolInputError(r.error ?? "This is not a valid JWT.");
    const claims = Object.entries(r.payload).map(([k, v]) => {
      const isTime = ["exp", "iat", "nbf", "auth_time", "updated_at"].includes(k) && typeof v === "number";
      const detail = isTime ? `${new Date((v as number) * 1000).toISOString()} (${relative((v as number) * 1000 - now)})` : CLAIM_MEANINGS[k] ?? "";
      return [k, typeof v === "object" ? JSON.stringify(v) : String(v), detail];
    });
    const stats: NonNullable<ToolResult["stats"]> = [
      { label: "Algorithm", value: String(r.header.alg ?? "?"), tone: String(r.header.alg).toLowerCase() === "none" ? "bad" : "neutral" },
      { label: "Status", value: r.expired ? "expired" : r.expiresAt ? "not expired" : "no expiry", tone: r.expired ? "bad" : r.expiresAt ? "good" : "warn" }
    ];
    const messages: NonNullable<ToolResult["messages"]> = r.warnings.map(w => ({ kind: "warning" as const, text: w }));
    const secret = str(values, "secret");
    if (secret) {
      try {
        const v = verifyJwtSignature(token, secret);
        if (v.note) messages.unshift({ kind: v.ok ? "info" : "warning", text: v.note });
        else {
          stats.push({ label: "Signature", value: v.ok ? "valid" : "INVALID", tone: v.ok ? "good" : "bad" });
          messages.unshift(v.ok ? { kind: "success", text: `The signature matches this ${isKeyMaterial(secret) ? "key" : "secret"}.` } : { kind: "error", text: `The signature does not match this ${isKeyMaterial(secret) ? "key" : "secret"}: the token was altered or signed with a different key.` });
        }
      } catch (error) {
        if (error instanceof ToolInputError) messages.unshift({ kind: "error", text: error.message });
        else throw error;
      }
    } else {
      messages.push({ kind: "info", text: "The signature was not verified. Decoding a token does not prove it is genuine - add the secret or public key." });
    }
    return {
      stats,
      messages,
      outputs: [
        table("Claims", ["Claim", "Value", "Meaning"], claims),
        code("Header", "json", JSON.stringify(r.header, null, 2)),
        code("Payload", "json", JSON.stringify(r.payload, null, 2))
      ]
    };
  }
};

const CLAIM_MEANINGS: Record<string, string> = { iss: "Issuer", sub: "Subject (user id)", aud: "Audience - the API this token is for", jti: "Token id (for revocation / replay checks)", azp: "Authorized party (client id)", scope: "Granted scopes", scp: "Granted scopes", roles: "Roles", email: "Email", email_verified: "Email verified by the issuer", sid: "Session id", nonce: "Must match the nonce sent in the auth request", at_hash: "Access token hash (OIDC)", tid: "Tenant id (Entra ID)", client_id: "Client id" };

function relative(ms: number): string {
  const abs = Math.abs(ms);
  const unit = abs >= 86_400_000 ? [86_400_000, "day"] : abs >= 3_600_000 ? [3_600_000, "hour"] : abs >= 60_000 ? [60_000, "minute"] : [1000, "second"];
  const n = Math.round(abs / (unit[0] as number));
  return ms >= 0 ? `in ${n} ${unit[1]}${n === 1 ? "" : "s"}` : `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
}

const hashTool: ToolSpec = {
  id: "dev.hash",
  command: "hashGenerator",
  title: "Hash, HMAC & Webhook Signatures",
  summary: "MD5, SHA-1, SHA-2 and SHA-3 hashes in hex and Base64; HMAC with any secret; and verify webhook signatures from GitHub, Stripe, Shopify, Slack or any HMAC-SHA256 sender.",
  guide: "Webhook signatures are computed over the exact raw request body. If yours never matches, the framework probably parsed and re-serialised the JSON (express.json(), NestJS body parser) - verify against the raw bytes. MD5 and SHA-1 are fine for checksums, never for passwords or signatures.",
  keywords: ["hash", "sha256", "sha1", "md5", "sha512", "sha3", "checksum", "hmac", "webhook", "signature", "x-hub-signature", "stripe-signature", "shopify hmac", "slack signature"],
  icon: "hash",
  live: true,
  fields: [
    f.select("mode", "Tool", opts(["hash", "Hash"], ["hmac", "HMAC"], ["webhook", "Verify a webhook signature"])),
    f.area("input", "Input", { rows: 5, required: true, fromEditor: true, default: "Hello, DevSnip Pro!", showIf: { field: "mode", equals: ["hash", "hmac"] } }),
    f.select("encoding", "Input is", opts(["utf8", "Text (UTF-8)"], ["hex", "Hex bytes"], ["base64", "Base64 bytes"]), { showIf: { field: "mode", equals: ["hash", "hmac"] } }),
    f.select("algorithm", "HMAC algorithm", opts(["sha256", "SHA-256"], ["sha1", "SHA-1"], ["sha384", "SHA-384"], ["sha512", "SHA-512"], ["md5", "MD5"]), { showIf: { field: "mode", equals: ["hmac"] } }),
    f.select("provider", "Sender", opts(["github", "GitHub (X-Hub-Signature-256)"], ["stripe", "Stripe (Stripe-Signature)"], ["shopify", "Shopify (X-Shopify-Hmac-Sha256)"], ["slack", "Slack (X-Slack-Signature)"], ["generic-hex", "Generic HMAC-SHA256, hex"], ["generic-base64", "Generic HMAC-SHA256, Base64"]), { showIf: { field: "mode", equals: ["webhook"] } }),
    f.code("payload", "Raw request body", "json", { rows: 6, default: '{"action":"opened","number":42}', showIf: { field: "mode", equals: ["webhook"] } }),
    f.text("signature", "Signature header value", { default: "sha256=5f1d1b8ab0d2b4b8c1f2c4e3a8b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9", showIf: { field: "mode", equals: ["webhook"] } }),
    f.text("timestamp", "Timestamp header (Slack / Stripe)", { width: "narrow", showIf: { field: "provider", equals: ["slack", "stripe"] } }),
    f.secret("secret", "Secret", { showIf: { field: "mode", equals: ["hmac", "webhook"] } })
  ],
  run(values, ctx) {
    const mode = str(values, "mode", "hash");
    if (mode === "webhook") {
      const secret = str(values, "secret");
      if (!secret) throw new ToolInputError("Enter the webhook signing secret.");
      const provider = str(values, "provider", "github") as WebhookProvider;
      const r = verifyWebhook({ provider, payload: str(values, "payload"), secret, signature: str(values, "signature"), timestamp: str(values, "timestamp"), now: ctx.now?.() ?? new Date() });
      const messages: NonNullable<ToolResult["messages"]> = r.notes.map(t => ({ kind: "warning" as const, text: t }));
      if (r.match === true) messages.unshift({ kind: "success", text: "The signature is valid for this body and secret." });
      if (r.match === false) messages.unshift({ kind: "error", text: "The signature does NOT match. Check that you use the raw body (no re-serialised JSON, same whitespace and line endings) and the right secret for this endpoint." });
      if (/\n\s{2,}"/.test(str(values, "payload"))) messages.push({ kind: "info", text: "The body looks pretty-printed. Senders sign the compact body exactly as sent; copy it from the raw request log." });
      return {
        stats: [{ label: "Result", value: r.match === undefined ? "no signature given" : r.match ? "valid" : "INVALID", tone: r.match === undefined ? "neutral" : r.match ? "good" : "bad" }, { label: "Header", value: r.header }],
        messages,
        outputs: [code("Expected signature", "text", r.expected), table("How it is computed", ["Step", "Value"], [["Algorithm", "HMAC-SHA256"], ["Signed content", r.signedContent], ["Encoding", provider === "shopify" || provider === "generic-base64" ? "Base64" : "hex"]]), code("Express handler", "typescript", webhookHandler(provider))]
      };
    }
    const input = str(values, "input");
    if (!input) throw new ToolInputError("Enter some input.");
    const encoding = str(values, "encoding", "utf8") as "utf8" | "hex" | "base64";
    if (mode === "hmac") {
      const secret = str(values, "secret");
      if (!secret) throw new ToolInputError("Enter the HMAC secret.");
      const algorithm = str(values, "algorithm", "sha256") as HashAlgorithm;
      const mac = hmac(input, secret, algorithm, encoding);
      return { outputs: [table(`HMAC-${algorithm.toUpperCase()}`, ["Encoding", "Value"], [["hex", mac.toString("hex")], ["Base64", mac.toString("base64")], ["Base64URL", mac.toString("base64url")]]), code("Node.js", "javascript", `import crypto from "node:crypto";\n\nconst mac = crypto.createHmac(${JSON.stringify(algorithm)}, process.env.SECRET).update(body).digest("hex");\n// Compare with crypto.timingSafeEqual, never ===\n`)] };
    }
    const algs = availableHashes();
    const rows = algs.map(a => { const d = digest(input, a, encoding); return [a.toUpperCase(), d.toString("hex"), d.toString("base64")]; });
    return {
      stats: [{ label: "Input", value: `${toBytes(input, encoding).length} bytes` }, { label: "Algorithms", value: String(rows.length) }],
      messages: [{ kind: "info", text: "Passwords need a slow, salted hash (bcrypt, scrypt, Argon2id) - not any of these." }],
      outputs: [table("Hashes", ["Algorithm", "Hex", "Base64"], rows), code("Verify a downloaded file", "shell", "shasum -a 256 file.zip          # macOS / Linux\ncertutil -hashfile file.zip SHA256   # Windows")]
    };
  }
};
export const DESKTOP_DEV_TOOLS: ToolSpec[] = [jwtTool, hashTool];
