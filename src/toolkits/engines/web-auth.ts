import { createHash, createHmac, createPrivateKey, createPublicKey, KeyObject, randomBytes, sign as cryptoSign, verify as cryptoVerify, constants, timingSafeEqual, getHashes } from "crypto";
import { ToolInputError } from "../types";

/**
 * Hashes, HMAC, webhook signatures, JWT signing/verification and OAuth 2.0
 * PKCE. Everything uses Node's crypto module locally; nothing is sent anywhere.
 */

export const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

// ---------------------------------------------------------------------------
// Hashes and HMAC
// ---------------------------------------------------------------------------

export const HASH_ALGORITHMS = ["md5", "sha1", "sha256", "sha384", "sha512", "sha3-256", "sha3-512"] as const;
export type HashAlgorithm = typeof HASH_ALGORITHMS[number];

export function availableHashes(): HashAlgorithm[] {
  const have = new Set(getHashes().map(h => h.toLowerCase()));
  return HASH_ALGORITHMS.filter(a => have.has(a));
}

export function digest(text: string, algorithm: HashAlgorithm, inputEncoding: "utf8" | "hex" | "base64"): Buffer {
  return createHash(algorithm).update(toBytes(text, inputEncoding)).digest();
}

export function hmac(text: string, secret: string, algorithm: HashAlgorithm, inputEncoding: "utf8" | "hex" | "base64"): Buffer {
  return createHmac(algorithm, secret).update(toBytes(text, inputEncoding)).digest();
}

export function toBytes(text: string, encoding: "utf8" | "hex" | "base64"): Buffer {
  if (encoding === "hex") {
    const clean = text.replace(/[\s:]/g, "");
    if (!/^([0-9a-f]{2})*$/i.test(clean)) throw new ToolInputError("The input is not valid hex.");
    return Buffer.from(clean, "hex");
  }
  if (encoding === "base64") {
    const clean = text.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(clean)) throw new ToolInputError("The input is not valid Base64.");
    return Buffer.from(clean.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  }
  return Buffer.from(text, "utf8");
}

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

export type WebhookProvider = "github" | "stripe" | "shopify" | "slack" | "generic-hex" | "generic-base64";

export interface WebhookCheck {
  provider: WebhookProvider;
  payload: string;
  secret: string;
  signature: string;
  timestamp?: string;
  now: Date;
}

export interface WebhookResult {
  expected: string;
  header: string;
  signedContent: string;
  match: boolean | undefined;
  notes: string[];
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function verifyWebhook(c: WebhookCheck): WebhookResult {
  const notes: string[] = [];
  const sig = c.signature.trim().replace(/^[\w-]+:\s*/, "");
  const hmacHex = (data: string) => createHmac("sha256", c.secret).update(data, "utf8").digest("hex");
  const hmacB64 = (data: string) => createHmac("sha256", c.secret).update(data, "utf8").digest("base64");
  switch (c.provider) {
    case "github": {
      const expected = `sha256=${hmacHex(c.payload)}`;
      return { expected, header: "X-Hub-Signature-256", signedContent: "the raw request body", match: sig ? safeEqual(sig, expected) : undefined, notes };
    }
    case "shopify": {
      const expected = hmacB64(c.payload);
      return { expected, header: "X-Shopify-Hmac-Sha256", signedContent: "the raw request body", match: sig ? safeEqual(sig, expected) : undefined, notes };
    }
    case "stripe": {
      const parts = Object.fromEntries(sig.split(",").map(p => p.split("=")).filter(p => p.length === 2).map(([k, v]) => [k.trim(), v.trim()]));
      const t = parts.t ?? c.timestamp?.trim();
      if (!t) throw new ToolInputError("Stripe signatures look like t=1700000000,v1=...; paste the whole Stripe-Signature header.");
      const expected = hmacHex(`${t}.${c.payload}`);
      const v1 = sig.split(",").filter(p => p.trim().startsWith("v1=")).map(p => p.trim().slice(3));
      const age = Math.round(c.now.getTime() / 1000) - Number(t);
      if (Number.isFinite(age) && Math.abs(age) > 300) notes.push(`The timestamp is ${Math.abs(age)} s ${age > 0 ? "old" : "in the future"}; Stripe's libraries reject events outside a 5-minute tolerance (replay protection).`);
      if (c.secret && !c.secret.startsWith("whsec_")) notes.push("Stripe endpoint secrets start with whsec_ (Dashboard → Webhooks, or the stripe listen output), not your API key.");
      return { expected: `t=${t},v1=${expected}`, header: "Stripe-Signature", signedContent: `"${t}." + the raw request body`, match: v1.length ? v1.some(v => safeEqual(v, expected)) : undefined, notes };
    }
    case "slack": {
      const ts = c.timestamp?.trim();
      if (!ts) throw new ToolInputError("Slack signs \"v0:{X-Slack-Request-Timestamp}:{body}\"; enter the timestamp header.");
      const expected = `v0=${hmacHex(`v0:${ts}:${c.payload}`)}`;
      const age = Math.round(c.now.getTime() / 1000) - Number(ts);
      if (Number.isFinite(age) && Math.abs(age) > 300) notes.push("The timestamp is more than 5 minutes off; Slack recommends rejecting such requests.");
      return { expected, header: "X-Slack-Signature", signedContent: `"v0:${ts}:" + the raw request body`, match: sig ? safeEqual(sig, expected) : undefined, notes };
    }
    case "generic-hex": {
      const expected = hmacHex(c.payload);
      const given = sig.replace(/^sha256=/i, "").toLowerCase();
      return { expected, header: "Signature header", signedContent: "the raw request body", match: sig ? safeEqual(given, expected) : undefined, notes };
    }
    case "generic-base64": {
      const expected = hmacB64(c.payload);
      return { expected, header: "Signature header", signedContent: "the raw request body", match: sig ? safeEqual(sig, expected) : undefined, notes };
    }
  }
}

export function webhookHandler(provider: WebhookProvider): string {
  const compute: Record<WebhookProvider, string> = {
    "github": `const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(req.body).digest("hex");\n  const given = req.get("X-Hub-Signature-256") ?? "";`,
    "shopify": `const expected = crypto.createHmac("sha256", SECRET).update(req.body).digest("base64");\n  const given = req.get("X-Shopify-Hmac-Sha256") ?? "";`,
    "stripe": `// Prefer the official SDK: stripe.webhooks.constructEvent(req.body, header, SECRET)\n  const header = req.get("Stripe-Signature") ?? "";\n  const t = /t=(\\d+)/.exec(header)?.[1] ?? "";\n  const expected = crypto.createHmac("sha256", SECRET).update(\`\${t}.\`).update(req.body).digest("hex");\n  const given = /v1=([0-9a-f]+)/.exec(header)?.[1] ?? "";\n  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return res.status(400).send("Stale event");`,
    "slack": `const ts = req.get("X-Slack-Request-Timestamp") ?? "";\n  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.status(400).send("Stale request");\n  const expected = "v0=" + crypto.createHmac("sha256", SECRET).update(\`v0:\${ts}:\`).update(req.body).digest("hex");\n  const given = req.get("X-Slack-Signature") ?? "";`,
    "generic-hex": `const expected = crypto.createHmac("sha256", SECRET).update(req.body).digest("hex");\n  const given = (req.get("X-Signature") ?? "").replace(/^sha256=/, "");`,
    "generic-base64": `const expected = crypto.createHmac("sha256", SECRET).update(req.body).digest("base64");\n  const given = req.get("X-Signature") ?? "";`
  };
  return `import crypto from "node:crypto";\nimport express from "express";\n\nconst SECRET = process.env.WEBHOOK_SECRET ?? "";\nconst app = express();\n\n// The signature covers the exact bytes sent. Use express.raw for this route:\n// express.json() re-serialises the body and the signature never matches.\napp.post("/webhooks", express.raw({ type: "*/*" }), (req, res) => {\n  ${compute[provider]}\n  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));\n  if (!ok) return res.status(401).send("Invalid signature");\n\n  const event = JSON.parse(req.body.toString("utf8"));\n  console.log("Verified webhook", event);\n  res.sendStatus(200);\n});\n\napp.listen(3000);\n`;
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

export const JWT_ALGS = ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"] as const;
export type JwtAlg = typeof JWT_ALGS[number];

const HASH_OF: Record<string, string> = { "256": "sha256", "384": "sha384", "512": "sha512" };

/** Rebuilds a PEM that lost its line breaks (pasted into a single-line box). */
export function normalizePem(input: string): string {
  const text = input.trim();
  const m = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!m) return text;
  const body = m[2].replace(/\s+/g, "");
  return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END ${m[1]}-----\n`;
}

function keyFromInput(input: string, kind: "private" | "public"): KeyObject {
  const text = input.trim();
  try {
    if (text.startsWith("{")) {
      const jwk = JSON.parse(text);
      const key = jwk.keys && Array.isArray(jwk.keys) ? jwk.keys[0] : jwk;
      return kind === "private" ? createPrivateKey({ key, format: "jwk" }) : createPublicKey({ key, format: "jwk" });
    }
    const pem = normalizePem(text);
    return kind === "private" ? createPrivateKey(pem) : createPublicKey(pem);
  } catch (error) {
    throw new ToolInputError(`Could not read the ${kind} key: ${error instanceof Error ? error.message : String(error)}. Paste a PEM (-----BEGIN ...) or a JWK.`);
  }
}

export function isKeyMaterial(text: string): boolean {
  return /-----BEGIN [A-Z ]*(KEY|CERTIFICATE)-----/.test(text) || /^\s*\{[\s\S]*"kty"/.test(text);
}

export function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, key: string): string {
  const alg = String(header.alg ?? "") as JwtAlg;
  if (!JWT_ALGS.includes(alg)) throw new ToolInputError(`Unsupported alg "${alg}". Use one of ${JWT_ALGS.join(", ")}.`);
  const input = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  let signature: Buffer;
  if (alg.startsWith("HS")) {
    if (!key) throw new ToolInputError("Enter the shared secret.");
    if (Buffer.byteLength(key) < Number(alg.slice(2)) / 8) throw new ToolInputError(`${alg} needs a secret of at least ${Number(alg.slice(2)) / 8} bytes (RFC 7518); a short secret can be brute-forced.`);
    signature = createHmac(HASH_OF[alg.slice(2)], key).update(input).digest();
  } else {
    if (!key) throw new ToolInputError("Enter the private key (PEM or JWK).");
    const k = keyFromInput(key, "private");
    if (alg === "EdDSA") signature = cryptoSign(null, Buffer.from(input), k);
    else if (alg.startsWith("ES")) signature = cryptoSign(HASH_OF[alg.slice(2)], Buffer.from(input), { key: k, dsaEncoding: "ieee-p1363" });
    else if (alg.startsWith("PS")) signature = cryptoSign(HASH_OF[alg.slice(2)], Buffer.from(input), { key: k, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: Number(alg.slice(2)) / 8 });
    else signature = cryptoSign(HASH_OF[alg.slice(2)], Buffer.from(input), k);
  }
  return `${input}.${b64url(signature)}`;
}

export function verifyJwtSignature(token: string, key: string): { ok: boolean; note?: string } {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[2]) return { ok: false, note: "The token has no signature part." };
  const header = JSON.parse(fromB64url(parts[0]).toString("utf8"));
  const alg = String(header.alg ?? "");
  const input = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = fromB64url(parts[2]);
  if (alg.startsWith("HS")) {
    const expected = createHmac(HASH_OF[alg.slice(2)] ?? "sha256", key).update(input).digest();
    return { ok: sig.length === expected.length && timingSafeEqual(sig, expected) };
  }
  if (!isKeyMaterial(key)) return { ok: false, note: `${alg} tokens are verified with the issuer's public key (PEM, certificate or JWK), not a shared secret.` };
  const k = keyFromInput(key, "public");
  if (alg === "EdDSA") return { ok: cryptoVerify(null, input, k, sig) };
  const hash = HASH_OF[alg.slice(2)];
  if (!hash) return { ok: false, note: `Unsupported alg ${alg}.` };
  if (alg.startsWith("ES")) return { ok: cryptoVerify(hash, input, { key: k, dsaEncoding: "ieee-p1363" }, sig) };
  if (alg.startsWith("PS")) return { ok: cryptoVerify(hash, input, { key: k, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: Number(alg.slice(2)) / 8 }, sig) };
  return { ok: cryptoVerify(hash, input, k, sig) };
}

// ---------------------------------------------------------------------------
// OAuth 2.0 + PKCE
// ---------------------------------------------------------------------------

export interface OAuthProvider { label: string; authorize: string; token: string; scope: string; extra?: Record<string, string>; note?: string }

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  custom: { label: "Custom", authorize: "https://auth.example.com/oauth2/authorize", token: "https://auth.example.com/oauth2/token", scope: "openid profile email" },
  google: { label: "Google", authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "openid email profile", extra: { access_type: "offline", prompt: "consent" }, note: "access_type=offline + prompt=consent returns a refresh token. Android/iOS clients use the reversed client ID as redirect scheme (com.googleusercontent.apps.XXX:/oauth2redirect)." },
  github: { label: "GitHub", authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", scope: "read:user user:email", note: "GitHub's token endpoint returns form-encoded data unless you send Accept: application/json. GitHub OAuth apps support PKCE (S256)." },
  microsoft: { label: "Microsoft Entra ID", authorize: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token", scope: "openid profile email offline_access", note: "Replace {tenant} with your tenant ID, or use common / organizations / consumers." },
  auth0: { label: "Auth0", authorize: "https://{domain}/authorize", token: "https://{domain}/oauth/token", scope: "openid profile email offline_access", extra: { audience: "https://api.example.com" }, note: "Set audience to your API identifier to get a JWT access token instead of an opaque one." },
  okta: { label: "Okta", authorize: "https://{domain}/oauth2/default/v1/authorize", token: "https://{domain}/oauth2/default/v1/token", scope: "openid profile email offline_access" },
  cognito: { label: "AWS Cognito", authorize: "https://{domain}.auth.{region}.amazoncognito.com/oauth2/authorize", token: "https://{domain}.auth.{region}.amazoncognito.com/oauth2/token", scope: "openid email profile" },
  keycloak: { label: "Keycloak", authorize: "https://{host}/realms/{realm}/protocol/openid-connect/auth", token: "https://{host}/realms/{realm}/protocol/openid-connect/token", scope: "openid profile email" },
  apple: { label: "Sign in with Apple", authorize: "https://appleid.apple.com/auth/authorize", token: "https://appleid.apple.com/auth/token", scope: "name email", extra: { response_mode: "form_post" }, note: "Requesting name or email requires response_mode=form_post, so the redirect URI must be a server endpoint. The client secret is a JWT you sign with your .p8 key (ES256)." }
};

export function pkcePair(verifier?: string): { verifier: string; challenge: string } {
  const v = verifier?.trim() || b64url(randomBytes(32));
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(v)) throw new ToolInputError("A code_verifier must be 43-128 characters of A-Z a-z 0-9 - . _ ~ (RFC 7636).");
  return { verifier: v, challenge: b64url(createHash("sha256").update(v).digest()) };
}

export const randomToken = (bytes = 16) => b64url(randomBytes(bytes));

export function parseCallback(url: string): Array<[string, string]> {
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw new ToolInputError("The callback is not a valid URL."); }
  const params = new URLSearchParams(u.search || (u.hash.startsWith("#") ? u.hash.slice(1) : ""));
  if (u.hash.length > 1 && !u.search) for (const [k, v] of new URLSearchParams(u.hash.slice(1))) params.set(k, v);
  return [...params];
}
