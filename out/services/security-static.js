"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeWorkspacePosture = exports.scanCloudText = exports.scanSourceText = exports.scanText = exports.SECRET_RULES = exports.CLOUD_RULES = exports.CODE_RULES = exports.credentialLiteral = exports.redactLine = exports.isCommentLine = exports.looksLikeSecretValue = exports.shannonEntropy = void 0;
const security_analysis_1 = require("./security-analysis");
/* ------------------------------------------------------------------ *
 * False-positive filters
 * ------------------------------------------------------------------ */
/** Values that are obviously not a live credential. */
const PLACEHOLDER_VALUE = new RegExp("^(?:" + [
    "<[^>]*>", "\\{\\{[^}]*\\}\\}", "\\$\\{[^}]*\\}", "\\$[A-Za-z_][A-Za-z0-9_]*", "%[A-Za-z_]+%",
    "process\\.env\\b", "os\\.environ\\b", "os\\.getenv", "System\\.getenv", "ENV\\[", "ENV\\.",
    "Deno\\.env", "import\\.meta\\.env", "config\\.", "settings\\.", "secrets\\.", "vault:",
    "your[-_ ]?", "my[-_ ]?", "the[-_ ]?", "some[-_ ]?", "a[-_ ]?valid",
    "x{3,}", "change[-_ ]?me", "replace[-_ ]?me", "placeholder", "example", "sample", "dummy",
    "redacted", "todo", "tbd", "n/?a", "none", "null", "nil", "undefined", "empty",
    "test", "fake", "foo", "bar", "baz", "password", "secret", "hunter2", "letmein",
    "\\*{3,}", "\\.{3,}", "-{3,}", "\\s*$"
].join("|") + ")", "i");
/** Shannon entropy in bits per character. */
function shannonEntropy(value) {
    if (!value.length)
        return 0;
    const counts = new Map();
    for (const character of value)
        counts.set(character, (counts.get(character) || 0) + 1);
    let entropy = 0;
    for (const count of counts.values()) {
        const probability = count / value.length;
        entropy -= probability * Math.log2(probability);
    }
    return entropy;
}
exports.shannonEntropy = shannonEntropy;
/**
 * Whether a value matched by a keyword rule is plausibly a real secret.
 *
 * This is the filter that separates `apiKey = "sk-live-9f8a7b6c"` from the far
 * more common `apiKey = process.env.API_KEY`.
 */
function looksLikeSecretValue(rawValue) {
    const value = rawValue.trim().replace(/^["'`]|["'`],?;?$/g, "").trim();
    if (value.length < 8 || value.length > 512)
        return false;
    if (PLACEHOLDER_VALUE.test(value))
        return false;
    // A reference to another variable or a function call, not a literal.
    if (/^[A-Za-z_$][\w$]*(?:\.[\w$]+)*\s*\(/.test(value))
        return false;
    if (/^[A-Z][A-Z0-9_]{2,}$/.test(value))
        return false;
    // A path, a URL without credentials, or a MIME type is not a secret.
    if (/^(?:\.{0,2}\/|[A-Za-z]:\\)/.test(value))
        return false;
    if (/^https?:\/\//i.test(value) && !/:[^/@\s]+@/.test(value))
        return false;
    if (/^[a-z]+\/[a-z0-9.+-]+$/i.test(value))
        return false;
    // Repeated or single-class filler.
    if (/^(.)\1+$/.test(value))
        return false;
    return shannonEntropy(value) >= 2.6;
}
exports.looksLikeSecretValue = looksLikeSecretValue;
/** URLs whose scheme is structural rather than a network call. */
const STRUCTURAL_HTTP_HOST = new RegExp([
    "www\\.w3\\.org", "schemas\\.", "xmlns", "\\.xsd", "\\.dtd", "purl\\.org",
    "json-schema\\.org", "docbook\\.org", "relaxng\\.org", "www\\.apache\\.org/licenses",
    "opensource\\.org/licenses", "creativecommons\\.org", "www\\.gnu\\.org/licenses",
    "maven\\.apache\\.org", "java\\.sun\\.com", "xml\\.org", "www\\.springframework\\.org",
    "jakarta\\.ee", "openoffice\\.org", "\\.openxmlformats\\.org", "ns\\.adobe\\.com"
].join("|"), "i");
const PRIVATE_HTTP_HOST = /http:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[\w-]+\.(?:local|internal|test|localhost)\b)/i;
/** True when the line is a comment rather than code. */
function isCommentLine(line) {
    const trimmed = line.trim();
    return trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*") ||
        trimmed.startsWith("/*") || trimmed.startsWith("<!--") || trimmed.startsWith("--") ||
        trimmed.startsWith(";") || trimmed.startsWith("%");
}
exports.isCommentLine = isCommentLine;
/** Masks anything that looks like a value so evidence is safe to display. */
function redactLine(line) {
    let masked = line.trim();
    // Quoted values.
    masked = masked.replace(/(["'`])([^"'`\n]{8,})\1/g, (_full, quote, value) => `${quote}${String(value).slice(0, 3)}${"•".repeat(Math.min(12, Math.max(3, String(value).length - 3)))}${quote}`);
    // Unquoted assignments.
    masked = masked.replace(/([:=]\s*)([^\s"'`,;{}()]{12,})/g, (_full, prefix, value) => `${prefix}${String(value).slice(0, 3)}${"•".repeat(Math.min(12, String(value).length - 3))}`);
    return masked.slice(0, 200);
}
exports.redactLine = redactLine;
/* ------------------------------------------------------------------ *
 * Rule sets
 * ------------------------------------------------------------------ */
const OWASP_A01 = "OWASP Top 10 A01: Broken Access Control";
const OWASP_A02 = "OWASP Top 10 A02: Cryptographic Failures";
const OWASP_A03 = "OWASP Top 10 A03: Injection";
const OWASP_A05 = "OWASP Top 10 A05: Security Misconfiguration";
const OWASP_A06 = "OWASP Top 10 A06: Vulnerable and Outdated Components";
const OWASP_A07 = "OWASP Top 10 A07: Identification and Authentication Failures";
const OWASP_A08 = "OWASP Top 10 A08: Software and Data Integrity Failures";
/**
 * A credential-like assignment.
 *
 * The `[\w.-]*` prefix is what makes `DB_PASSWORD=` and `POSTGRES_PASSWORD:`
 * match, which a `\b` anchor cannot do because an underscore is a word
 * character. Requiring the keyword to sit immediately before the separator
 * keeps `tokenizer:` and `passwordConfirmation:` out.
 */
const KEYWORD_SECRET = /(?:^|[\s"'`[{(,>-])[\w.-]*(api[_-]?key|secret[_-]?key|access[_-]?token|client[_-]?secret|auth[_-]?token|private[_-]?key|encryption[_-]?key|password|passwd|pwd|secret)\s*[:=]\s*(.+)$/i;
/**
 * Extracts the literal a credential-shaped assignment is set to.
 *
 * The distinction that matters is quoted versus not. In code, a credential is
 * only a finding when it is a string literal: `password: resolvedPassword` and
 * `apiKey: options.apiKey` are references, and treating them as secrets was by
 * far the largest source of noise. In a `.env`, `.ini` or YAML file the value
 * is normally unquoted, so there the bare token is accepted instead.
 */
function credentialLiteral(raw) {
    // Drop a trailing comment and the punctuation that ends a statement.
    let text = raw.replace(/\s+(?:#|\/\/)\s.*$/, "").trim();
    const quoted = /^(["'`])((?:[^\\]|\\.)*?)\1\s*[,;)\]}]*\s*$/.exec(text);
    if (quoted)
        return { value: quoted[2], quoted: true };
    text = text.replace(/[,;]+$/, "").trim();
    if (!text || /\s/.test(text))
        return undefined;
    // A member path is always a reference, never a literal.
    if (/^[A-Za-z_$][\w$]*(?:\.[\w$]+)+$/.test(text))
        return undefined;
    // So is an interpolation or a shell/CI expression.
    if (/^[$%!&](?:\{|\(|[A-Za-z_])/.test(text) || text.includes("${"))
        return undefined;
    return { value: text, quoted: false };
}
exports.credentialLiteral = credentialLiteral;
/** File kinds where an unquoted value is the normal way to write a secret. */
const DATA_FILE_EXTENSIONS = new Set(["env", "ini", "conf", "config", "properties", "yaml", "yml", "toml", "cfg", "dockerfile"]);
/** The infrastructure variant: same shape, a slightly wider keyword set. */
const CLOUD_KEYWORD_SECRET = /(?:^|[\s"'`[{(,>-])[\w.-]*(access[_-]?key|secret[_-]?key|client[_-]?secret|api[_-]?key|token|password|passwd)\s*[:=]\s*(.+)$/i;
/** Source-code rules. */
exports.CODE_RULES = [
    /* ---- Secrets -------------------------------------------------- */
    {
        rule: "generic-secret",
        title: "Hard-coded credential",
        category: "configuration",
        severity: "high",
        message: "A credential-shaped literal is assigned directly in source. Anything committed to a repository is readable by everyone with repository access and stays in the history after it is deleted.",
        remediation: "Move the value to an environment variable or a secret manager, rotate the exposed value, and add a pre-commit secret scanner so the next one is caught before it lands.",
        reference: OWASP_A02,
        pattern: KEYWORD_SECRET,
        accept: (line, file) => {
            const match = KEYWORD_SECRET.exec(line);
            if (!match)
                return false;
            const literal = credentialLiteral(match[2]);
            if (!literal)
                return false;
            // In source, only a quoted literal is a credential; anything else is a
            // reference to one. Data files carry unquoted values, so they are exempt.
            if (!literal.quoted && !DATA_FILE_EXTENSIONS.has(extensionOf(file)))
                return false;
            return looksLikeSecretValue(literal.value);
        }
    },
    /* ---- Injection ------------------------------------------------ */
    {
        rule: "unsafe-eval",
        title: "Dynamic code execution",
        category: "injection",
        severity: "medium",
        message: "`eval` and `new Function` compile a string into code. Any request value that reaches one of them becomes executable, which is remote code execution rather than a lesser injection.",
        remediation: "Replace dynamic evaluation with an explicit parser, a lookup table, or `JSON.parse` for data.",
        reference: OWASP_A03,
        // The lookbehind keeps `model.eval()`, `tf.eval()` and similar method
        // calls out, which were the dominant false positive.
        pattern: /(?<![.\w$])eval\s*\(|new\s+Function\s*\(/,
        accept: line => !/\/\/\s*(?:eslint|nosec|lgtm)/i.test(line)
    },
    {
        rule: "shell-injection",
        title: "Shell command built from interpolated input",
        category: "injection",
        severity: "high",
        message: "The command string is assembled from variables. A value containing `;`, `&&` or a backtick breaks out of the intended command and runs arbitrary code with the service's privileges.",
        remediation: "Use the argument-array form (`execFile`, `spawn`, `subprocess.run([...])`) so the shell never parses the input, and validate the value against an allow-list.",
        reference: OWASP_A03,
        pattern: /(?:child_process\.)?(?:exec|execSync)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)|\bos\.system\s*\(\s*(?:f["']|[^)]*\+)|\bsubprocess\.(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True/,
    },
    {
        rule: "sql-string-concat",
        title: "SQL built by string concatenation",
        category: "injection",
        severity: "high",
        message: "A query is assembled from a template literal or string addition. If any part of it comes from a request, the value is parsed as SQL rather than treated as data - the textbook SQL injection.",
        remediation: "Use parameter binding (`?`/`$1` placeholders, or the ORM's query builder). Never interpolate a value into SQL, even one you believe is safe.",
        reference: OWASP_A03,
        // The clause shape (a FROM, a SET, an INTO) is what separates real SQL from
        // the English word "select" in a UI string, which was a false positive.
        pattern: /\b(?:SELECT\s+[\w*`"[][^;\n]{0,80}\bFROM\s+[\w`"[]|INSERT\s+INTO\s+[\w`"[]|UPDATE\s+[\w`"[][^;\n]{0,60}\bSET\b|DELETE\s+FROM\s+[\w`"[])[^;\n]{0,120}?(?:\$\{|["']\s*\+\s*\w|%s["']\s*%\s*\w|f["'][^"']*\{)/i
    },
    {
        rule: "dom-xss-sink",
        title: "Untrusted value written to a DOM HTML sink",
        category: "injection",
        severity: "medium",
        message: "Assigning to `innerHTML`, `outerHTML` or calling `document.write` parses the string as markup. A value that came from a URL, a message or an API response can inject script here.",
        remediation: "Use `textContent` for text, build nodes with `createElement`, or sanitise with a maintained library such as DOMPurify before assigning.",
        reference: OWASP_A03,
        extensions: ["js", "jsx", "ts", "tsx", "vue", "svelte", "html"],
        pattern: /\.(?:inner|outer)HTML\s*=\s*(?!["'`]\s*["'`])|document\.write(?:ln)?\s*\(|insertAdjacentHTML\s*\(/,
        // Assigning a constant string injects nothing; the finding is the
        // concatenation or interpolation of a value into markup.
        accept: line => !/\.(?:inner|outer)HTML\s*=\s*(["'`])(?:(?!\1)[^\\])*\1\s*;?\s*$/.test(line) ||
            /document\.write|insertAdjacentHTML/.test(line)
    },
    {
        rule: "react-dangerous-html",
        title: "dangerouslySetInnerHTML with a dynamic value",
        category: "injection",
        severity: "medium",
        message: "React's escaping is bypassed here. Whatever the expression evaluates to is parsed as HTML, so any untrusted segment of it becomes script.",
        remediation: "Render the value as text, or sanitise it with DOMPurify immediately before it is passed in.",
        reference: OWASP_A03,
        extensions: ["js", "jsx", "ts", "tsx"],
        pattern: /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:\s*(?!["'`])/
    },
    {
        rule: "path-traversal",
        title: "Filesystem path built from request input",
        category: "injection",
        severity: "high",
        message: "A path passed to the filesystem is composed from request data. A value containing `../` escapes the intended directory and reads or writes arbitrary files.",
        remediation: "Resolve the path and verify it still starts with the intended root (`path.resolve(root, name).startsWith(root)`), or map the input through an allow-list of known filenames.",
        reference: OWASP_A01,
        pattern: /\b(?:readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|sendFile|unlink|open)\s*\([^)]*\b(?:req|request|ctx|params|query|body)\b\s*[.[]/
    },
    {
        rule: "unsafe-deserialization",
        title: "Unsafe deserialisation",
        category: "injection",
        severity: "high",
        message: "These loaders instantiate arbitrary types from the serialised data. Feeding them untrusted bytes is a direct path to remote code execution.",
        remediation: "Use `yaml.safe_load` / `yaml.SafeLoader`, `json.loads`, or a schema-validated format. Never unpickle or `Marshal.load` data that crossed a trust boundary.",
        reference: OWASP_A08,
        pattern: /\bpickle\.(?:load|loads)\s*\(|\byaml\.load\s*\((?![^)]*Safe)|\bMarshal\.load\s*\(|\bObjectInputStream\s*\(|\bunserialize\s*\(/
    },
    /* ---- Cryptography & randomness -------------------------------- */
    {
        rule: "weak-hash",
        title: "Broken hash function",
        category: "configuration",
        severity: "medium",
        message: "MD5 and SHA-1 have practical collision attacks. They must not be used for signatures, integrity checks or password storage; for a non-security checksum they are merely a smell.",
        remediation: "Use SHA-256 or better for integrity, and a memory-hard KDF (bcrypt, scrypt, Argon2) for passwords - never a plain hash.",
        reference: OWASP_A02,
        pattern: /\b(?:createHash|new\s+MessageDigest|hashlib\.|Digest::)\s*\(?\s*["']?(?:md5|sha-?1)["']?|\bMD5\s*\(|\bgetInstance\s*\(\s*["'](?:MD5|SHA-?1)["']/i
    },
    {
        rule: "insecure-random",
        title: "Non-cryptographic randomness used for a secret",
        category: "configuration",
        severity: "medium",
        message: "`Math.random` and `random.random()` are predictable from a small number of outputs. A token, password or session id derived from them can be guessed.",
        remediation: "Use `crypto.randomBytes` / `crypto.getRandomValues` in JavaScript, `secrets` in Python, or `SecureRandom` on the JVM.",
        reference: OWASP_A02,
        pattern: /\b(?:token|secret|password|nonce|salt|otp|session[_-]?id|api[_-]?key|reset[_-]?code)\b[^=\n]{0,40}=\s*[^=\n]{0,60}\b(?:Math\.random\s*\(|random\.(?:random|randint|choice)\s*\(|rand\s*\()/i
    },
    {
        rule: "tls-verification-disabled",
        title: "TLS certificate verification disabled",
        category: "transport",
        severity: "high",
        message: "The client is told to accept any certificate. That removes the only thing that distinguishes the real server from an interceptor, so the connection is encrypted but not authenticated.",
        remediation: "Remove the flag. If a private CA is involved, add its root to the trust store (`NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`) rather than disabling verification.",
        reference: OWASP_A02,
        pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*["']?0|verify\s*=\s*False\b|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)|--no-check-certificate|ServerCertificateValidationCallback\s*\+?=/i
    },
    {
        rule: "insecure-http",
        title: "Plain-HTTP endpoint in source",
        category: "transport",
        severity: "low",
        message: "A non-local http:// URL is used for an outbound request or configuration value, so that traffic is readable and modifiable on the network path.",
        remediation: "Use https for every external endpoint and fail closed if the TLS handshake does not succeed.",
        reference: OWASP_A02,
        pattern: /\bhttp:\/\/[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|\b)|\bhttp:\/\/[\w-]+:\d+/i,
        // XML namespaces, schema locations and licence URLs are identifiers, not
        // network calls, and were the main source of noise from this rule.
        accept: line => !STRUCTURAL_HTTP_HOST.test(line) && !PRIVATE_HTTP_HOST.test(line)
    },
    /* ---- Web framework configuration ------------------------------ */
    {
        rule: "cors-wildcard-in-code",
        title: "CORS configured to allow any origin",
        category: "cors",
        severity: "medium",
        message: "The server is configured to accept every origin. Combined with cookie or header credentials, that lets any site read authenticated responses.",
        remediation: "Replace the wildcard with an explicit allow-list, and only enable credentials for origins on that list.",
        reference: OWASP_A05,
        pattern: /Access-Control-Allow-Origin["']?\s*[,:]\s*["']\*["']|origin\s*:\s*(?:true|["']\*["'])|CORS_ORIGIN_ALLOW_ALL\s*=\s*True|allowedOrigins\s*\(\s*["']\*["']/i
    },
    {
        rule: "insecure-cookie-config",
        title: "Cookie security flag disabled in configuration",
        category: "cookies",
        severity: "high",
        message: "A session or cookie option explicitly turns off `secure` or `httpOnly`. That makes the cookie readable by script or transmittable over plain HTTP.",
        remediation: "Set `secure: true` and `httpOnly: true` (plus `sameSite: 'lax'`) for session cookies, and use a separate, readable cookie if the front end genuinely needs one.",
        reference: OWASP_A05,
        // The flag name alone matches any object literal with a `secure: false`
        // field, so the rule requires cookie or session context on the same line.
        pattern: /(?:cookie|session)[^\n]{0,80}\b(?:httpOnly|secure|sameSite)\s*[:=]\s*(?:false|False|0)\b|\b(?:SESSION_COOKIE_SECURE|SESSION_COOKIE_HTTPONLY|CSRF_COOKIE_SECURE)\s*[:=]\s*(?:false|False|0)\b/i
    },
    {
        rule: "csrf-disabled",
        title: "CSRF protection disabled",
        category: "configuration",
        severity: "high",
        message: "The framework's CSRF protection is switched off. Without it, any site a logged-in user visits can make state-changing requests on their behalf using their cookies.",
        remediation: "Re-enable CSRF protection. For an API consumed with bearer tokens instead of cookies, confirm no cookie-based session exists before exempting a route.",
        reference: OWASP_A01,
        pattern: /csrf\s*[:=]\s*(?:false|False|off|disable)|@csrf_exempt\b|csrfProtection\s*:\s*false|WithCsrfProtection\s*\(\s*false|\.csrf\s*\(\s*\)\s*\.disable\s*\(/i
    },
    {
        rule: "debug-enabled",
        title: "Debug mode enabled",
        category: "configuration",
        severity: "medium",
        message: "Debug mode returns stack traces, interactive consoles and configuration dumps to the client. In several frameworks the debug console is a direct remote-code-execution path.",
        remediation: "Drive debug from an environment variable that defaults to off, and assert it is off in the production configuration.",
        reference: OWASP_A05,
        pattern: /\bDEBUG\s*[:=]\s*(?:True|true|1)\b|app\.debug\s*=\s*True|FLASK_ENV\s*[:=]\s*development|APP_DEBUG\s*=\s*true|RAILS_ENV\s*=\s*development/
    },
    {
        rule: "wildcard-allowed-hosts",
        title: "Host header validation disabled",
        category: "configuration",
        severity: "medium",
        message: "Accepting any Host header lets an attacker control absolute URLs the application generates - password-reset links, for one - and poison caches keyed on them.",
        remediation: "List the exact hostnames the service answers on.",
        reference: OWASP_A05,
        pattern: /ALLOWED_HOSTS\s*=\s*\[\s*["']\*["']\s*\]|host\s*:\s*["']\*["']/
    },
    {
        rule: "jwt-decode-without-verify",
        title: "JWT read without verifying its signature",
        category: "auth",
        severity: "high",
        message: "`decode` only base64-decodes the token. Using its claims for an authorization decision means trusting values the caller can rewrite at will.",
        remediation: "Use `verify` with a pinned algorithm list and the correct key, and only read claims from the verified result.",
        reference: OWASP_A07,
        pattern: /\bjwt\.decode\s*\(|jsonwebtoken\.decode\s*\(|\bdecode\s*\([^)]*verify\s*[:=]\s*(?:False|false)/
    },
    /* ---- Supply chain --------------------------------------------- */
    {
        rule: "pipe-to-shell",
        title: "Remote script piped into a shell",
        category: "configuration",
        severity: "high",
        message: "Downloading a script and executing it immediately means whatever that URL serves at that moment runs with the current privileges. A compromised host, a hijacked domain or a MITM all turn into code execution.",
        remediation: "Download to a file, pin and verify a checksum or signature, then execute. In CI, prefer a pinned package or a vendored binary.",
        reference: OWASP_A08,
        pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z|k|)sh\b/i
    },
    {
        rule: "unpinned-ci-action",
        title: "Third-party CI action referenced by a moving tag",
        category: "configuration",
        severity: "medium",
        message: "A tag can be moved to a different commit by whoever owns the action. The workflow then runs code you never reviewed, with access to the repository and its secrets.",
        remediation: "Pin third-party actions to a full commit SHA (`uses: owner/action@<40-char sha>`) and let Dependabot raise the updates.",
        reference: OWASP_A08,
        extensions: ["yml", "yaml"],
        pattern: /^\s*(?:-\s*)?uses\s*:\s*(?!actions\/|github\/|docker\/)[\w.-]+\/[\w.-]+@(?!\b[0-9a-f]{40}\b)[\w.-]+/,
        accept: (_line, file) => /\.github[\\/]workflows[\\/]/.test(file)
    },
    {
        rule: "ci-script-injection",
        title: "Workflow interpolates untrusted event data into a shell",
        category: "injection",
        severity: "high",
        message: "`${{ github.event.* }}` is substituted into the script before the shell runs it. A pull-request title or branch name containing shell syntax executes as part of the job.",
        remediation: "Pass the value through an `env:` entry and reference it as `\"$VAR\"` inside the script, so the shell treats it as data.",
        reference: OWASP_A03,
        extensions: ["yml", "yaml"],
        pattern: /\$\{\{\s*github\.event\.(?:issue|pull_request|comment|review)?\.?[\w.]*(?:title|body|head_ref|ref|name|label|message|login)[\w.]*\s*\}\}/,
        accept: (_line, file) => /\.github[\\/]workflows[\\/]/.test(file)
    },
    {
        rule: "pull-request-target",
        title: "Workflow uses pull_request_target",
        category: "configuration",
        severity: "high",
        message: "`pull_request_target` runs with repository secrets and write permissions in the context of the base branch. Checking out the pull request's head in that job lets a fork's code read those secrets.",
        remediation: "Use `pull_request` for anything that builds fork code. If `pull_request_target` is required, never check out the PR head in the same job.",
        reference: OWASP_A08,
        extensions: ["yml", "yaml"],
        pattern: /^\s*(?:-\s*)?pull_request_target\s*:/,
        accept: (_line, file) => /\.github[\\/]workflows[\\/]/.test(file)
    }
];
/** Infrastructure-as-code and container rules. */
exports.CLOUD_RULES = [
    {
        rule: "public-network-ingress",
        title: "Network rule open to the whole internet",
        category: "configuration",
        severity: "high",
        message: "A security group, firewall rule or network policy accepts traffic from 0.0.0.0/0 or ::/0. Everything behind it is reachable by anyone who can find the address.",
        remediation: "Restrict the source to the CIDR ranges that actually need access, or put the service behind a load balancer or bastion and open only that.",
        reference: OWASP_A05,
        pattern: /(?:0\.0\.0\.0\/0|::\/0)/,
        // A documented default or an egress rule to the internet is normal.
        accept: line => !/egress|outbound|destination|route|gateway|nat/i.test(line)
    },
    {
        rule: "wildcard-iam-permission",
        title: "IAM policy grants a wildcard",
        category: "configuration",
        severity: "high",
        message: "A policy statement uses `*` for its action or resource, so the principal can perform far more than the workload needs. A compromise of that identity becomes a compromise of the account.",
        remediation: "List the specific actions and resource ARNs the workload uses. Generate the list from CloudTrail or Access Analyzer rather than guessing.",
        reference: OWASP_A01,
        pattern: /(?:"?(?:Action|Resource|NotAction)"?\s*[:=]\s*\[?\s*"?\*"?|["']?(?:actions?|resources?)["']?\s*[:=]\s*\[?\s*["']\*["'])/i
    },
    {
        rule: "public-cloud-storage",
        title: "Object storage allows public access",
        category: "configuration",
        severity: "high",
        message: "The bucket or container is configured for public read (or read-write) access. Every object in it is downloadable by anyone with the URL, and a public-write bucket can be used to host content under your domain.",
        remediation: "Set the ACL to private and enable the account-level public-access block. Serve genuinely public files through a CDN with signed URLs or an origin access identity.",
        reference: OWASP_A01,
        pattern: /(?:public[_-]?access|acl|access[_-]?control)\s*[:=]\s*["']?(?:public-read-write|public-read|true)\b/i
    },
    {
        rule: "cloud-secret-value",
        title: "Credential embedded in infrastructure configuration",
        category: "configuration",
        severity: "critical",
        message: "A credential literal is written into infrastructure configuration. Terraform state, Kubernetes manifests and Compose files are routinely committed, copied and shared, so the value is effectively public.",
        remediation: "Reference a secret manager (AWS Secrets Manager, Vault, Kubernetes Secret with an external provider) and rotate the exposed value now.",
        reference: OWASP_A02,
        pattern: CLOUD_KEYWORD_SECRET,
        accept: line => {
            const match = CLOUD_KEYWORD_SECRET.exec(line);
            if (!match)
                return false;
            // `${{ secrets.X }}`, `!Ref`, `valueFrom:` and friends are references.
            if (/\$\{|\$\(|!Ref|!Sub|!GetAtt|valueFrom|secretKeyRef|configMapKeyRef|vault:|sops:|aws_secretsmanager|data\.\w+/i.test(line))
                return false;
            const literal = credentialLiteral(match[2]);
            if (!literal)
                return false;
            return looksLikeSecretValue(literal.value);
        }
    },
    {
        rule: "privileged-container",
        title: "Container runs with elevated privileges",
        category: "configuration",
        severity: "high",
        message: "A privileged container shares the host's device access and capability set, so a process that escapes the application has the host. `allowPrivilegeEscalation` permits a child process to gain more privilege than its parent.",
        remediation: "Set `privileged: false` and `allowPrivilegeEscalation: false`, drop all capabilities and add back only the ones the workload needs.",
        reference: OWASP_A05,
        pattern: /(?:privileged|allowPrivilegeEscalation)\s*[:=]\s*(?:true|["']true["'])/i
    },
    {
        rule: "container-runs-as-root",
        title: "Container is not pinned to a non-root user",
        category: "configuration",
        severity: "medium",
        message: "`runAsNonRoot: false` (or `runAsUser: 0`) lets the workload run as root inside the container, which widens what a container escape or a mounted volume can reach.",
        remediation: "Set `runAsNonRoot: true` with a specific `runAsUser`, and build the image with a `USER` instruction.",
        reference: OWASP_A05,
        pattern: /runAsNonRoot\s*:\s*false|runAsUser\s*:\s*0\b/i
    },
    {
        rule: "host-networking",
        title: "Workload shares a host namespace",
        category: "configuration",
        severity: "high",
        message: "Sharing the host network, PID or IPC namespace removes the isolation the container was meant to provide. A workload on the host network can reach services bound to the host's loopback interface, including cloud metadata and unauthenticated admin ports.",
        remediation: "Remove the host namespace setting and expose the container through a Service or a published port instead.",
        reference: OWASP_A05,
        pattern: /host(?:Network|PID|IPC)\s*:\s*true|network_mode\s*[:=]\s*["']host["']/i
    },
    {
        rule: "unencrypted-storage",
        title: "Storage encryption explicitly disabled",
        category: "configuration",
        severity: "medium",
        message: "Encryption at rest is turned off for a volume, bucket or database. A snapshot, a decommissioned disk or a copied backup then contains readable data.",
        remediation: "Enable encryption at rest with a customer-managed key where the compliance regime calls for it, and enable it on snapshots too.",
        reference: OWASP_A02,
        pattern: /(?:encrypted|encryption|server_side_encryption|storage_encrypted)\s*[:=]\s*(?:false|["']false["'])/i
    },
    {
        rule: "missing-tls",
        title: "TLS explicitly disabled in configuration",
        category: "transport",
        severity: "medium",
        message: "A service is configured to run without TLS. Traffic between components is then readable by anything on the same network segment.",
        remediation: "Enable TLS on the listener, or terminate TLS at a mesh sidecar and restrict the plaintext port to the pod network.",
        reference: OWASP_A02,
        pattern: /(?:tls|ssl|enable_https|https_only|use_tls)\s*[:=]\s*(?:false|["']false["']|0)\b/i
    },
    {
        rule: "latest-container-tag",
        title: "Mutable image tag",
        category: "configuration",
        severity: "medium",
        message: "`:latest` resolves to whatever the registry serves at pull time. Two nodes can run different code, a rollback does not roll anything back, and a compromised registry entry is deployed automatically.",
        remediation: "Pin the image to an immutable digest (`image@sha256:…`) or at least a specific version tag, and let a bot raise updates.",
        reference: OWASP_A08,
        pattern: /image\s*[:=]\s*["']?[^\s"':]+:latest\b/i
    },
    {
        rule: "imds-v1-allowed",
        title: "Instance metadata service v1 left enabled",
        category: "configuration",
        severity: "medium",
        message: "IMDSv1 answers unauthenticated GET requests, which is what turns a server-side request forgery in the application into cloud credential theft.",
        remediation: "Set `http_tokens = \"required\"` on the instance metadata options so only IMDSv2 (session-token) requests are answered.",
        reference: OWASP_A05,
        pattern: /http_tokens\s*=\s*["']optional["']/i
    },
    {
        rule: "public-database",
        title: "Managed database is publicly accessible",
        category: "configuration",
        severity: "high",
        message: "The database instance is given a public endpoint. Even with authentication, that exposes it to internet-wide credential stuffing and to any authentication bypass in the engine.",
        remediation: "Set `publicly_accessible = false` and reach the database over private networking or a bastion.",
        reference: OWASP_A05,
        pattern: /publicly_accessible\s*=\s*true|public_network_access_enabled\s*=\s*true/i
    },
    {
        rule: "no-logging",
        title: "Audit logging disabled",
        category: "configuration",
        severity: "low",
        message: "Logging or audit trails are explicitly turned off for this resource, which means an incident involving it cannot be reconstructed afterwards.",
        remediation: "Enable access logging and ship it to a retained, tamper-evident store.",
        reference: "OWASP Top 10 A09: Security Logging and Monitoring Failures",
        pattern: /(?:logging|audit_?logs?|enable_logging|access_logs)\s*[:=]\s*(?:false|["']false["'])/i
    },
    {
        rule: "dockerfile-add-remote",
        title: "Dockerfile ADD fetches a remote URL",
        category: "configuration",
        severity: "medium",
        message: "`ADD <url>` downloads at build time with no integrity check, so the image contents depend on what that host served during the build.",
        remediation: "Use `RUN curl -fsSL <url> -o file && echo \"<sha256>  file\" | sha256sum -c -`, or vendor the artifact.",
        reference: OWASP_A08,
        pattern: /^\s*ADD\s+https?:\/\//i
    }
];
/* ------------------------------------------------------------------ *
 * Scanning
 * ------------------------------------------------------------------ */
/** Format-matched credentials, reported with near-zero false positives. */
const SECRET_FORMAT_RULES = security_analysis_1.SECRET_PATTERNS
    // A JWT in a fixture or a test vector is common enough that reporting every
    // one as a leak would bury the rules that matter.
    .filter(pattern => pattern.id !== "jwt-token")
    .map(pattern => ({
    rule: pattern.id,
    title: pattern.label,
    category: "configuration",
    severity: (pattern.severity === "none" ? "low" : pattern.severity),
    message: `A value matching the exact format of a ${pattern.label.toLowerCase()} is present in this file. Format-matched credentials are almost never a coincidence.`,
    remediation: pattern.remediation,
    reference: OWASP_A02,
    pattern: pattern.pattern,
    // Vendor documentation uses fixed placeholder keys. Reporting one of those
    // as a leaked credential is a false positive by construction.
    accept: line => !(0, security_analysis_1.isDocumentedExampleCredential)(line)
}));
exports.SECRET_RULES = [...SECRET_FORMAT_RULES, ...exports.CODE_RULES];
function extensionOf(file) {
    const name = file.toLowerCase().replace(/\\/g, "/").split("/").pop() || "";
    if (name === "dockerfile" || name.startsWith("dockerfile."))
        return "dockerfile";
    if (name.startsWith(".env"))
        return "env";
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1) : "";
}
/** Caps the findings any one rule may produce for one file. */
const MAX_PER_RULE_PER_FILE = 20;
/**
 * Runs a rule set over one file's text.
 *
 * Matching is line-by-line so every finding carries a line number the UI can
 * jump to, and so a rule can never match across unrelated statements.
 */
function scanText(file, text, rules) {
    const findings = [];
    const extension = extensionOf(file);
    const lines = text.split(/\r?\n/);
    const perRule = new Map();
    const applicable = rules.filter(rule => !rule.extensions || rule.extensions.includes(extension));
    if (!applicable.length)
        return findings;
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!line.trim())
            continue;
        // A very long line is almost always minified or generated output.
        if (line.length > 2000)
            continue;
        const comment = isCommentLine(line);
        for (const rule of applicable) {
            // Secrets in a comment are still secrets; a code smell in one is not.
            if (comment && rule.category !== "configuration")
                continue;
            // Reset lastIndex defensively in case a rule ever carries /g.
            rule.pattern.lastIndex = 0;
            if (!rule.pattern.test(line))
                continue;
            if (rule.accept && !rule.accept(line, file))
                continue;
            const seen = perRule.get(rule.rule) || 0;
            if (seen >= MAX_PER_RULE_PER_FILE)
                continue;
            perRule.set(rule.rule, seen + 1);
            findings.push({
                rule: rule.rule,
                title: rule.title,
                category: rule.category,
                severity: rule.severity,
                message: rule.message,
                remediation: rule.remediation,
                reference: rule.reference,
                file,
                line: index + 1,
                evidence: redactLine(line)
            });
        }
    }
    return findings;
}
exports.scanText = scanText;
function scanSourceText(file, text) {
    return scanText(file, text, exports.SECRET_RULES);
}
exports.scanSourceText = scanSourceText;
function scanCloudText(file, text) {
    return scanText(file, text, exports.CLOUD_RULES);
}
exports.scanCloudText = scanCloudText;
function findFile(files, matcher) {
    for (const [path, text] of files) {
        if (matcher.test(path.replace(/\\/g, "/")))
            return [path, text];
    }
    return undefined;
}
/** Packages that are unmaintained or carry a known, unfixable security issue. */
const DISCOURAGED_PACKAGES = {
    request: "Deprecated since 2020 and no longer receives security fixes. Replace with `undici`, `axios` or the built-in `fetch`.",
    "node-uuid": "Renamed to `uuid` and abandoned under this name. Switch to `uuid`.",
    "hoek": "Superseded by `@hapi/hoek`; the unscoped package is unmaintained.",
    "cryptiles": "Superseded by `@hapi/cryptiles`; the unscoped package is unmaintained.",
    "sha.js": "Historically shipped prototype-pollution issues; prefer the built-in `crypto` module.",
    "md5": "MD5 is broken for any security purpose. Use the `crypto` module with SHA-256.",
    "faker": "The original package was sabotaged by its author in 2022. Use `@faker-js/faker`.",
    "colors": "The original package was sabotaged by its author in 2022. Pin it or move to `chalk`.",
    "event-stream": "Compromised in a 2018 supply-chain attack. Confirm the pinned version predates it or remove the dependency.",
    "left-pad": "Trivial functionality with a history of registry instability. Use `String.prototype.padStart`.",
    "growl": "Contains a long-standing command-injection issue with no fix.",
    "npmconf": "Unmaintained; depends on packages with unresolved advisories."
};
/**
 * Assesses dependency and security configuration from manifest files.
 *
 * These are the checks that can produce a *pass*, which matters: a report made
 * only of findings gives no signal that anything was verified.
 */
function analyzeWorkspacePosture(files) {
    const checks = [];
    const paths = [...files.keys()].map(path => path.replace(/\\/g, "/"));
    const has = (matcher) => paths.some(path => matcher.test(path));
    /* ---- Node.js manifest ----------------------------------------- */
    const manifest = findFile(files, /(?:^|\/)package\.json$/);
    if (manifest) {
        const [manifestPath, manifestText] = manifest;
        let parsed;
        try {
            parsed = JSON.parse(manifestText);
        }
        catch {
            checks.push({
                id: "deps.manifest-parse", title: "package.json could not be parsed", category: "dependencies",
                status: "warn", severity: "low", file: manifestPath,
                detail: "The manifest is not valid JSON, so the dependency checks could not run against it.",
                remediation: "Fix the JSON syntax; most tooling silently ignores a manifest it cannot parse."
            });
            parsed = undefined;
        }
        if (parsed) {
            const dependencies = {
                ...(parsed.dependencies || {}),
                ...(parsed.devDependencies || {}),
                ...(parsed.optionalDependencies || {})
            };
            const names = Object.keys(dependencies);
            // Lockfile
            const lockfile = has(/(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb)$/);
            checks.push(lockfile
                ? {
                    id: "deps.lockfile", title: "A dependency lockfile is committed", category: "dependencies",
                    status: "pass", severity: "low", file: manifestPath,
                    detail: "Installs resolve to the exact versions in the lockfile, so a build is reproducible and a newly published malicious version is not pulled in silently."
                }
                : {
                    id: "deps.lockfile", title: "No dependency lockfile is committed", category: "dependencies",
                    status: "fail", severity: "medium", file: manifestPath,
                    detail: "Without a lockfile every install resolves ranges afresh, so two builds of the same commit can contain different code - and a compromised release inside an allowed range is installed automatically.",
                    remediation: "Commit `package-lock.json` (or the equivalent for your package manager) and use `npm ci` in CI so the lockfile is enforced rather than updated.",
                    reference: OWASP_A08
                });
            // Floating ranges
            const floating = names.filter(name => /^(?:\*|x|latest|)$/i.test(String(dependencies[name]).trim()) ||
                /^(?:>=?|\^?\s*\*)/.test(String(dependencies[name]).trim()));
            if (floating.length) {
                checks.push({
                    id: "deps.floating", title: "Dependencies are declared with an unbounded range", category: "dependencies",
                    status: "warn", severity: "medium", file: manifestPath,
                    detail: `${floating.length} dependency range(s) have no upper bound (${floating.slice(0, 5).join(", ")}${floating.length > 5 ? ", …" : ""}). Any future release, including a malicious one, satisfies them.`,
                    evidence: floating.slice(0, 5).map(name => `${name}: ${dependencies[name]}`).join(" · "),
                    remediation: "Use a caret or tilde range with a known-good floor, and rely on the lockfile plus an update bot rather than an open range.",
                    reference: OWASP_A08
                });
            }
            // Non-registry sources
            const remote = names.filter(name => /^(?:git\+)?(?:http|git|ssh):\/\//i.test(String(dependencies[name])));
            const insecureRemote = remote.filter(name => /^(?:git\+)?http:\/\//i.test(String(dependencies[name])));
            if (insecureRemote.length) {
                checks.push({
                    id: "deps.insecure-source", title: "Dependency fetched over plain HTTP", category: "dependencies",
                    status: "fail", severity: "high", file: manifestPath,
                    detail: `${insecureRemote.join(", ")} resolve over http://, so the package contents can be replaced in transit by anyone on the network path.`,
                    evidence: insecureRemote.map(name => `${name}: ${dependencies[name]}`).join(" · "),
                    remediation: "Use an https or ssh URL, and pin a commit SHA rather than a branch.",
                    reference: OWASP_A08
                });
            }
            else if (remote.length) {
                checks.push({
                    id: "deps.remote-source", title: "Dependencies resolve outside the registry", category: "dependencies",
                    status: "info", severity: "low", file: manifestPath,
                    detail: `${remote.length} dependency(ies) point at a git or URL source. That is fine when the reference is pinned to a commit, and a supply-chain risk when it tracks a branch.`,
                    evidence: remote.slice(0, 4).map(name => `${name}: ${dependencies[name]}`).join(" · ")
                });
            }
            // Known-bad packages
            const discouraged = names.filter(name => DISCOURAGED_PACKAGES[name]);
            if (discouraged.length) {
                checks.push({
                    id: "deps.discouraged", title: "Unmaintained or compromised packages are declared", category: "dependencies",
                    status: "warn", severity: "medium", file: manifestPath,
                    detail: discouraged.map(name => `${name}: ${DISCOURAGED_PACKAGES[name]}`).join(" "),
                    evidence: discouraged.join(", "),
                    remediation: "Replace each package with its maintained successor, then re-run the dependency audit.",
                    reference: OWASP_A06
                });
            }
            else if (names.length) {
                checks.push({
                    id: "deps.discouraged", title: "No known-abandoned packages declared", category: "dependencies",
                    status: "pass", severity: "low", file: manifestPath,
                    detail: `${names.length} declared dependency(ies) were matched against a list of packages that are abandoned or were compromised in a supply-chain incident, with no hit. This is not a substitute for \`npm audit\`, which checks published advisories.`
                });
            }
            // Install-time scripts on dependencies are the main npm attack path.
            const scripts = parsed.scripts || {};
            const dangerousScripts = Object.entries(scripts).filter(([, value]) => /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?\w*sh\b/i.test(String(value)) || /\brm\s+-rf\s+\/(?:\s|$)/.test(String(value)));
            if (dangerousScripts.length) {
                checks.push({
                    id: "deps.dangerous-script", title: "An npm script pipes a remote file into a shell", category: "dependencies",
                    status: "fail", severity: "high", file: manifestPath,
                    detail: `The ${dangerousScripts.map(([name]) => `\`${name}\``).join(", ")} script downloads and executes code in one step, so whatever that URL serves runs with the developer's privileges.`,
                    evidence: dangerousScripts.map(([name, value]) => `${name}: ${String(value).slice(0, 80)}`).join(" · "),
                    remediation: "Download, verify a checksum, then execute - or install the tool as a pinned dependency.",
                    reference: OWASP_A08
                });
            }
            // Engine pinning helps reproducibility but is not a security control;
            // reported as info rather than graded.
            if (!parsed.engines) {
                checks.push({
                    id: "deps.engines", title: "No Node.js version constraint in the manifest", category: "dependencies",
                    status: "info", severity: "low", file: manifestPath,
                    detail: "`engines` is not declared, so the project can be built on a Node version that is past end-of-life and no longer receives security patches.",
                    remediation: "Declare an `engines.node` range covering only supported releases."
                });
            }
        }
    }
    /* ---- npm configuration ---------------------------------------- */
    const npmrc = findFile(files, /(?:^|\/)\.npmrc$/);
    if (npmrc) {
        const [npmrcPath, npmrcText] = npmrc;
        if (/_authToken\s*=|_auth\s*=|_password\s*=/i.test(npmrcText) && !/\$\{/.test(npmrcText)) {
            checks.push({
                id: "config.npmrc-token", title: "A registry token is written into .npmrc", category: "configuration",
                status: "fail", severity: "critical", file: npmrcPath,
                detail: "The file contains a literal registry credential. If it is committed, anyone with repository access can publish packages as you.",
                evidence: ".npmrc contains an _authToken / _auth entry",
                remediation: "Replace the literal with `${NPM_TOKEN}`, add `.npmrc` to `.gitignore`, and revoke the exposed token now.",
                reference: OWASP_A02
            });
        }
        if (/strict-ssl\s*=\s*false/i.test(npmrcText)) {
            checks.push({
                id: "config.npmrc-ssl", title: "npm certificate verification disabled", category: "configuration",
                status: "fail", severity: "high", file: npmrcPath,
                detail: "`strict-ssl=false` makes npm accept any certificate, so package downloads can be intercepted and replaced.",
                evidence: "strict-ssl=false",
                remediation: "Remove the setting and add your corporate CA with `cafile=` instead.",
                reference: OWASP_A02
            });
        }
    }
    /* ---- Python manifests ----------------------------------------- */
    const requirements = findFile(files, /(?:^|\/)requirements(?:[\w.-]*)?\.txt$/);
    if (requirements) {
        const [reqPath, reqText] = requirements;
        if (/--(?:trusted-host|index-url\s+http:)/i.test(reqText)) {
            checks.push({
                id: "deps.pip-insecure", title: "pip is configured to trust an unverified index", category: "dependencies",
                status: "fail", severity: "high", file: reqPath,
                detail: "`--trusted-host` or a plain-HTTP index disables certificate verification for package downloads, so package contents can be replaced in transit.",
                evidence: (reqText.match(/--(?:trusted-host|index-url)\s+\S+/i) || [""])[0],
                remediation: "Use an https index and add the private CA to the trust store instead of trusting the host blindly.",
                reference: OWASP_A08
            });
        }
        const lines = reqText.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
        const unpinned = lines.filter(line => !/[=<>~!]=|@/.test(line));
        if (unpinned.length) {
            checks.push({
                id: "deps.pip-unpinned", title: "Python dependencies are not pinned", category: "dependencies",
                status: "warn", severity: "medium", file: reqPath,
                detail: `${unpinned.length} of ${lines.length} requirement(s) carry no version specifier, so each install resolves to whatever is newest on PyPI at that moment.`,
                evidence: unpinned.slice(0, 5).join(", "),
                remediation: "Pin with `==` and manage upgrades through `pip-compile` or `uv lock`, which produce a hash-pinned lock file.",
                reference: OWASP_A08
            });
        }
        else if (lines.length) {
            checks.push({
                id: "deps.pip-unpinned", title: "Python dependencies are pinned", category: "dependencies",
                status: "pass", severity: "low", file: reqPath,
                detail: `All ${lines.length} requirement(s) carry a version specifier.`
            });
        }
    }
    /* ---- Secret hygiene ------------------------------------------- */
    const gitignore = findFile(files, /(?:^|\/)\.gitignore$/);
    const envFiles = paths.filter(path => /(?:^|\/)\.env(?:\.[\w-]+)?$/.test(path) && !/\.env\.(?:example|sample|template|dist)$/.test(path));
    if (envFiles.length) {
        const ignored = gitignore ? /^\s*\.env\b|^\s*\*\.env|^\s*\.env\*/m.test(gitignore[1]) : false;
        checks.push(ignored
            ? {
                id: "config.env-ignored", title: "Environment files are excluded from version control", category: "configuration",
                status: "pass", severity: "low", file: gitignore?.[0],
                detail: `${envFiles.length} environment file(s) exist in the workspace and \`.gitignore\` excludes them.`
            }
            : {
                id: "config.env-ignored", title: "Environment files are not excluded from version control", category: "configuration",
                status: "fail", severity: "high", file: envFiles[0],
                detail: `${envFiles.length} environment file(s) are present (${envFiles.slice(0, 3).join(", ")}) and \`.gitignore\` does not exclude them. These files exist to hold credentials, so committing one publishes every secret in it - and the history keeps it after a later deletion.`,
                evidence: envFiles.slice(0, 3).join(", "),
                remediation: "Add `.env` and `.env.*` (with an exception for `.env.example`) to `.gitignore`. If one has already been committed, rotate every value in it and purge the history.",
                reference: OWASP_A02
            });
    }
    /* ---- Repository security posture ------------------------------ */
    checks.push(has(/(?:^|\/)(?:\.github\/)?SECURITY\.md$/i)
        ? {
            id: "config.security-policy", title: "A security policy is published", category: "configuration",
            status: "pass", severity: "low",
            detail: "SECURITY.md documents how to report a vulnerability, which is what keeps a finding coming to you privately rather than going public."
        }
        : {
            id: "config.security-policy", title: "No SECURITY.md", category: "configuration",
            status: "info", severity: "low",
            detail: "The repository has no disclosure policy. It is not a vulnerability, but without one a reporter has no documented private channel.",
            remediation: "Add a SECURITY.md with a contact address and the response you commit to."
        });
    checks.push(has(/(?:^|\/)\.github\/dependabot\.ya?ml$/) || has(/(?:^|\/)renovate\.json5?$/) || has(/(?:^|\/)\.github\/renovate\.json5?$/)
        ? {
            id: "config.dependency-updates", title: "Automated dependency updates are configured", category: "dependencies",
            status: "pass", severity: "low",
            detail: "Dependabot or Renovate is configured, so advisories in dependencies surface as pull requests instead of waiting for someone to notice."
        }
        : {
            id: "config.dependency-updates", title: "No automated dependency updates", category: "dependencies",
            status: "warn", severity: "low",
            detail: "Neither Dependabot nor Renovate is configured. Vulnerable transitive dependencies are the most common way a project inherits a known CVE, and they are only found if something is looking.",
            remediation: "Add `.github/dependabot.yml` with `package-ecosystem` entries for each manifest, or configure Renovate.",
            reference: OWASP_A06
        });
    const workflows = paths.filter(path => /\.github\/workflows\/.+\.ya?ml$/.test(path));
    if (workflows.length) {
        const workflowText = workflows.map(path => files.get(path) || files.get(path.replace(/\//g, "\\")) || "").join("\n");
        const scanning = /codeql|semgrep|trivy|snyk|gitleaks|trufflehog|bandit|npm audit|osv-scanner|dependency-review/i.test(workflowText);
        checks.push(scanning
            ? {
                id: "config.ci-scanning", title: "CI runs a security scan", category: "configuration",
                status: "pass", severity: "low",
                detail: "At least one workflow runs a code, dependency or secret scanner, so regressions are caught on the pull request rather than in production."
            }
            : {
                id: "config.ci-scanning", title: "CI does not run a security scan", category: "configuration",
                status: "warn", severity: "medium",
                detail: `${workflows.length} workflow(s) were found and none runs a recognised security scanner (CodeQL, Semgrep, Trivy, gitleaks, npm audit or similar). Nothing systematically checks for a reintroduced secret or a newly vulnerable dependency.`,
                remediation: "Add a CodeQL or Semgrep job plus a secret scanner and a dependency review step to the pull-request workflow.",
                reference: OWASP_A06
            });
        const permissionsDeclared = /^\s*permissions\s*:/m.test(workflowText);
        checks.push(permissionsDeclared
            ? {
                id: "config.ci-permissions", title: "Workflow token permissions are declared", category: "configuration",
                status: "pass", severity: "low",
                detail: "At least one workflow narrows `GITHUB_TOKEN` permissions instead of inheriting the repository default."
            }
            : {
                id: "config.ci-permissions", title: "Workflows do not narrow token permissions", category: "configuration",
                status: "warn", severity: "medium",
                detail: "No workflow declares a `permissions:` block, so each job runs with whatever the repository default grants - often write access to contents, packages and pull requests. Any compromised step inherits all of it.",
                remediation: "Add `permissions: { contents: read }` at the workflow level and widen it per job only where a write is genuinely needed.",
                reference: OWASP_A01
            });
    }
    return checks;
}
exports.analyzeWorkspacePosture = analyzeWorkspacePosture;
//# sourceMappingURL=security-static.js.map