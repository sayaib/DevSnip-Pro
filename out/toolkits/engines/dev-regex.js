"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testRegex = exports.regexCode = exports.validateRegex = exports.REGEX_LIBRARY = void 0;
const types_1 = require("../types");
exports.REGEX_LIBRARY = [
    { id: "email", label: "Email address (practical)", pattern: "^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$", flags: "", samples: "ada@example.com\nfirst.last+tag@sub.example.co.uk\nnot-an-email\nada@localhost", note: "Validates the common shape only. The real check is sending a confirmation email." },
    { id: "url", label: "URL (http / https)", pattern: "^https?:\\/\\/(?:[\\w-]+\\.)+[a-z]{2,}(?::\\d{2,5})?(?:[\\/?#][^\\s]*)?$", flags: "i", samples: "https://example.com\nhttp://api.example.co.uk:8080/v1/users?id=7#top\nftp://example.com\nexample.com", note: "For real parsing use new URL() / Uri.parse(); regexes miss edge cases." },
    { id: "uuid", label: "UUID (any version)", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", flags: "i", samples: "3fa85f64-5717-4562-b3fc-2c963f66afa6\n0190b3c4-6f1e-7a2b-9c3d-4e5f6a7b8c9d\nnot-a-uuid" },
    { id: "objectid", label: "MongoDB ObjectId", pattern: "^[0-9a-fA-F]{24}$", flags: "", samples: "507f1f77bcf86cd799439011\n507f1f77bcf86cd79943901" },
    { id: "ipv4", label: "IPv4 address", pattern: "^(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)$", flags: "", samples: "192.168.1.20\n10.0.2.2\n256.1.1.1\n1.2.3" },
    { id: "hex-color", label: "Hex colour (#RGB, #RRGGBB, #RRGGBBAA)", pattern: "^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$", flags: "", samples: "#fff\n#1E88E5\n#1E88E580\n#12345" },
    { id: "semver", label: "Semantic version", pattern: "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$", flags: "", samples: "1.4.2\n2.0.0-rc.1+build.7\n1.02.3\nv1.2.3", note: "The official semver.org pattern (no leading v)." },
    { id: "slug", label: "URL slug", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", flags: "", samples: "my-first-post\nhello\nHello-World\ndouble--dash" },
    { id: "phone-e164", label: "Phone number (E.164)", pattern: "^\\+[1-9]\\d{6,14}$", flags: "", samples: "+14155552671\n+919876543210\n4155552671\n+0123", note: "Store phones in E.164; use libphonenumber for formatting and per-country validation." },
    { id: "date-iso", label: "Date (YYYY-MM-DD)", pattern: "^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])$", flags: "", samples: "2026-10-01\n2026-13-01\n2026-02-30", note: "Shape only: 2026-02-30 passes. Parse the date to validate it." },
    { id: "datetime-iso", label: "ISO 8601 date-time", pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d{1,9})?)?(?:Z|[+-]\\d{2}:?\\d{2})$", flags: "", samples: "2026-10-01T09:30:00Z\n2026-10-01T09:30:00.123+05:30\n2026-10-01 09:30" },
    { id: "time-24h", label: "Time (24h HH:MM[:SS])", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$", flags: "", samples: "09:30\n23:59:59\n24:00" },
    { id: "jwt", label: "JWT (three Base64URL parts)", pattern: "^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*$", flags: "", samples: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc\nnot.a" },
    { id: "password", label: "Strong password (8+, upper, lower, digit, symbol)", pattern: "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^A-Za-z0-9]).{8,}$", flags: "", samples: "Sup3r$ecret\npassword\nPassw0rd", note: "Uses lookaheads (not supported by Go's RE2). Length beats complexity: prefer a 12+ minimum and a breached-password check." },
    { id: "username", label: "Username (3-20, letters, digits, _ .)", pattern: "^(?=.{3,20}$)(?![_.])(?!.*[_.]{2})[a-zA-Z0-9._]+(?<![_.])$", flags: "", samples: "ada_lovelace\n_ada\nad\nada..l" },
    { id: "domain", label: "Domain name", pattern: "^(?=.{1,253}$)(?:(?!-)[A-Za-z0-9-]{1,63}(?<!-)\\.)+[A-Za-z]{2,63}$", flags: "", samples: "example.com\nsub.example.co.uk\n-bad.com\nlocalhost" },
    { id: "card", label: "Card number (13-19 digits, spaces/dashes)", pattern: "^(?:\\d[ -]?){12,18}\\d$", flags: "", samples: "4242 4242 4242 4242\n4000-0566-5566-5556\n1234", note: "Shape only - run a Luhn check, and never store card numbers yourself (use a PCI-compliant provider)." },
    { id: "postal-us", label: "US ZIP code", pattern: "^\\d{5}(?:-\\d{4})?$", flags: "", samples: "94103\n94103-1234\n9410" },
    { id: "base64", label: "Base64", pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$", flags: "", samples: "SGVsbG8=\nSGVsbG8\nnot base64!" },
    { id: "html-tag", label: "HTML tag (for stripping / scanning)", pattern: "<\\/?[a-zA-Z][^>]*>", flags: "g", samples: "<p class=\"x\">Hello <b>world</b></p>", note: "Never parse HTML with regex for security decisions; use a parser or sanitizer (DOMPurify)." },
    { id: "whitespace", label: "Repeated whitespace (collapse)", pattern: "\\s{2,}", flags: "g", samples: "too   many    spaces" },
    { id: "android-package", label: "Android package / iOS bundle id", pattern: "^[a-zA-Z][a-zA-Z0-9_]*(?:\\.[a-zA-Z][a-zA-Z0-9_]*)+$", flags: "", samples: "com.example.app\ncom.example.app.dev\nexample\n1com.example" },
    { id: "env-var", label: ".env line (KEY=value)", pattern: "^\\s*(?:export\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)?\\s*$", flags: "m", samples: "DATABASE_URL=postgres://localhost/app\nexport API_KEY=abc\n# comment\n1BAD=x" }
];
const usesLookaround = (p) => /\(\?<?[=!]/.test(p);
const usesBackref = (p) => /\\[1-9]|\\k</.test(p);
function validateRegex(pattern, flags) {
    if (!pattern)
        throw new types_1.ToolInputError("Enter a pattern.");
    const clean = flags.replace(/[^dgimsuyv]/g, "");
    try {
        return new RegExp(pattern, [...new Set(clean)].join(""));
    }
    catch (e) {
        throw new types_1.ToolInputError(`Invalid regular expression: ${e.message}`);
    }
}
exports.validateRegex = validateRegex;
function regexCode(pattern, flags, lang) {
    const i = flags.includes("i"), m = flags.includes("m"), s = flags.includes("s"), g = flags.includes("g");
    switch (lang) {
        case "javascript":
        case "typescript": {
            const lit = `/${pattern.replace(/(^|[^\\])\//g, "$1\\/")}/${[...new Set(flags.replace(/[^dgimsuyv]/g, ""))].join("")}`;
            return { code: `const pattern = ${lit};\n\n${g ? `const matches = [...input.matchAll(pattern)].map(m => m[0]);` : `const ok = pattern.test(input);\nconst match = input.match(pattern); // match?.[1] = first group`}\n` };
        }
        case "python": {
            const py = pattern.replace(/\(\?<([A-Za-z_]\w*)>/g, "(?P<$1>");
            const lit = !py.includes('"') && !py.endsWith("\\") ? `r"${py}"` : !py.includes("'") && !py.endsWith("\\") ? `r'${py}'` : JSON.stringify(py);
            const fl = [i && "re.IGNORECASE", m && "re.MULTILINE", s && "re.DOTALL"].filter(Boolean).join(" | ");
            return { code: `import re\n\nPATTERN = re.compile(${lit}${fl ? `, ${fl}` : ""})\n\n${g ? "matches = PATTERN.findall(text)" : "ok = PATTERN.search(text) is not None   # or PATTERN.fullmatch(text) for whole-string validation\nm = PATTERN.search(text)               # m.group(1) = first group"}\n`, note: py !== pattern ? "Named groups were rewritten to Python's (?P<name>…) syntax." : undefined };
        }
        case "dart": {
            const lit = !pattern.includes("'") ? `r'${pattern}'` : !pattern.includes('"') ? `r"${pattern}"` : `'${pattern.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$")}'`;
            const opts = [i && "caseSensitive: false", m && "multiLine: true", s && "dotAll: true", flags.includes("u") && "unicode: true"].filter(Boolean).join(", ");
            return { code: `final pattern = RegExp(${lit}${opts ? `, ${opts}` : ""});\n\n${g ? "final matches = pattern.allMatches(input).map((m) => m.group(0)!).toList();" : "final ok = pattern.hasMatch(input);\nfinal first = pattern.firstMatch(input)?.group(1);"}\n` };
        }
        case "kotlin": {
            const body = pattern.replace(/\$(?=[A-Za-z_{])/g, () => "${'$'}"); // a function: "$'" is special in replacement strings
            const opts = [i && "RegexOption.IGNORE_CASE", m && "RegexOption.MULTILINE", s && "RegexOption.DOT_MATCHES_ALL"].filter(Boolean);
            return { code: `val pattern = Regex("""${body}"""${opts.length ? `, setOf(${opts.join(", ")})` : ""})\n\n${g ? "val matches = pattern.findAll(input).map { it.value }.toList()" : "val ok = pattern.matches(input)          // whole string\nval first = pattern.find(input)?.groupValues?.getOrNull(1)"}\n` };
        }
        case "swift": {
            const hashes = pattern.includes('"#') ? "##" : "#";
            const opts = [i && ".caseInsensitive", m && ".anchorsMatchLines", s && ".dotMatchesLineSeparators"].filter(Boolean);
            return { code: `import Foundation\n\nlet pattern = try NSRegularExpression(pattern: ${hashes}"${pattern}"${hashes}${opts.length ? `, options: [${opts.join(", ")}]` : ""})\nlet range = NSRange(input.startIndex..., in: input)\n\n${g ? "let matches = pattern.matches(in: input, range: range).compactMap { Range($0.range, in: input).map { String(input[$0]) } }" : "let ok = pattern.firstMatch(in: input, range: range) != nil"}\n\n// Swift 5.7+ also has regex literals: let regex = try Regex(${hashes}"${pattern}"${hashes})\n` };
        }
        case "java": {
            const opts = [i && "Pattern.CASE_INSENSITIVE", m && "Pattern.MULTILINE", s && "Pattern.DOTALL"].filter(Boolean);
            return { code: `import java.util.regex.Matcher;\nimport java.util.regex.Pattern;\n\nprivate static final Pattern PATTERN = Pattern.compile(${JSON.stringify(pattern)}${opts.length ? `, ${opts.join(" | ")}` : ""});\n\n${g ? "Matcher matcher = PATTERN.matcher(input);\nwhile (matcher.find()) {\n    System.out.println(matcher.group());\n}" : "boolean ok = PATTERN.matcher(input).matches(); // whole string; use find() for a substring"}\n` };
        }
        case "go": {
            const prefix = [i && "i", m && "m", s && "s"].filter(Boolean).join("");
            const body = `${prefix ? `(?${prefix})` : ""}${pattern}`;
            const note = usesLookaround(pattern) || usesBackref(pattern) ? "Go's regexp (RE2) does not support lookarounds or backreferences: this pattern will not compile in Go. Validate those rules in code instead." : undefined;
            return { code: `import "regexp"\n\nvar pattern = regexp.MustCompile(${body.includes("`") ? JSON.stringify(body) : "`" + body + "`"})\n\n${g ? "matches := pattern.FindAllString(input, -1)" : "ok := pattern.MatchString(input)\nfirst := pattern.FindStringSubmatch(input) // first[1] = first group"}\n`, note };
        }
        case "php": {
            const delim = pattern.includes("/") ? "~" : "/";
            const mods = [i && "i", m && "m", s && "s", flags.includes("u") && "u"].filter(Boolean).join("");
            return { code: `<?php\n$pattern = '${delim}${pattern.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}${delim}${mods}';\n\n${g ? "preg_match_all($pattern, $input, $matches);" : "$ok = preg_match($pattern, $input, $m) === 1; // $m[1] = first group"}\n` };
        }
        case "csharp": {
            const opts = [i && "RegexOptions.IgnoreCase", m && "RegexOptions.Multiline", s && "RegexOptions.Singleline"].filter(Boolean);
            return { code: `using System.Text.RegularExpressions;\n\nvar pattern = new Regex(@"${pattern.replace(/"/g, '""')}"${opts.length ? `, ${opts.join(" | ")}` : ""});\n\n${g ? "var matches = pattern.Matches(input);" : "bool ok = pattern.IsMatch(input);"}\n` };
        }
    }
}
exports.regexCode = regexCode;
function testRegex(re, input, perLine) {
    const rows = [];
    const MAX = 500;
    if (perLine) {
        for (const [n, line] of input.split(/\r?\n/).entries()) {
            if (!line && n === input.split(/\r?\n/).length - 1)
                continue;
            const local = new RegExp(re.source, re.flags.replace("g", ""));
            const m = local.exec(line);
            rows.push([n + 1, line, m ? "✓" : "✗", m ? m.slice(1).map(x => x ?? "").join(" | ") : ""]);
            if (rows.length >= MAX)
                break;
        }
        return rows;
    }
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m;
    let n = 0;
    while ((m = global.exec(input)) && n < MAX) {
        rows.push([++n, m[0], m.index, m.slice(1).map(x => x ?? "").join(" | ")]);
        if (m[0] === "")
            global.lastIndex++;
    }
    return rows;
}
exports.testRegex = testRegex;
//# sourceMappingURL=dev-regex.js.map