import { curlAxiosNode as toAxiosNode, curlCSharp as toCSharp } from "./curl-targets";
import { ToolInputError } from "../types";

/**
 * cURL → code. The parser understands what browsers' "Copy as cURL" and API
 * docs produce (bash and cmd quoting, line continuations, combined short
 * flags, --data variants, -F, -u, -b, -G, --json); generators emit idiomatic
 * code for the HTTP client of each stack, web and mobile.
 */

export interface CurlRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body?: string;
  /** json: body is valid JSON; form: urlencoded; multipart: see `form`; raw: anything else. */
  bodyKind: "none" | "json" | "form" | "multipart" | "raw";
  form: Array<{ name: string; value: string; file: boolean; contentType?: string; filename?: string }>;
  basicAuth?: { user: string; password: string };
  insecure: boolean;
  followRedirects: boolean;
  compressed: boolean;
  timeoutSeconds?: number;
  proxy?: string;
  ignored: string[];
  /** Explicit file reference; never read by the converter. */
  bodyFile?: string;
  connectTimeoutSeconds?: number;
  warnings?: string[];
  suppressedHeaders?: string[];
}

export { tokenizeShell } from "./curl-shell";
export { parseCurl, parseCurlCommands } from "./curl-parser";

// ---------------------------------------------------------------------------
// String literals per language
// ---------------------------------------------------------------------------

const js = (s: string) => JSON.stringify(s);
const py = (s: string) => JSON.stringify(s); // JSON escapes are valid Python escapes
const dart = (s: string) => JSON.stringify(s).replace(/\$/g, "\\$");
const kotlin = (s: string) => JSON.stringify(s).replace(/\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/g, escape => escape === "\\f" ? "\\u000c" : escape).replace(/\$/g, "\\$");
const swift = (s: string) => '"' + Array.from(s).map(c => c === "\\" ? "\\\\" : c === '"' ? '\\"' : c === "\n" ? "\\n" : c === "\r" ? "\\r" : c === "\t" ? "\\t" : c.codePointAt(0)! < 32 || c === "\u007f" ? `\\u{${c.codePointAt(0)!.toString(16)}}` : c).join("") + '"';
const goStr = (s: string) => JSON.stringify(s);
const java = (s: string) => JSON.stringify(s);
const php = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

function formPairs(body: string): Array<[string, string]> {
  return body.split("&").filter(Boolean).map(p => {
    const eq = p.indexOf("=");
    const dec = (s: string) => { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; } };
    return eq < 0 ? [dec(p), ""] : [dec(p.slice(0, eq)), dec(p.slice(eq + 1))];
  });
}

/** Headers without the ones each client sets itself. */
function plainHeaders(r: CurlRequest, drop: string[] = []): Array<[string, string]> {
  const skip = new Set(["content-length", "host", ...drop.map(d => d.toLowerCase())]);
  return r.headers.filter(([k]) => !skip.has(k.toLowerCase()));
}

function basicHeader(r: CurlRequest): Array<[string, string]> {
  return r.basicAuth && !r.headers.some(([k]) => /^authorization$/i.test(k)) ? [["Authorization", `Basic ${Buffer.from(`${r.basicAuth.user}:${r.basicAuth.password}`).toString("base64")}`]] : [];
}

export type CurlTarget = "fetch-ts" | "axios-node" | "python-httpx" | "csharp" | "fetch" | "axios" | "node-fetch" | "python" | "go" | "php" | "java" | "dart-http" | "dart-dio" | "kotlin-okhttp" | "swift" | "http" | "httpie";

export interface CurlGenerateOptions { response?: "auto" | "json" | "text" | "bytes"; reusable?: boolean }

export const CURL_TARGETS: Array<{ id: CurlTarget; label: string; language: string; file: string }> = [
  { id: "fetch", label: "JavaScript fetch (browser, React, React Native)", language: "javascript", file: "request.js" },
  { id: "fetch-ts", label: "TypeScript fetch (browser)", language: "typescript", file: "request.ts" },
  { id: "axios-node", label: "Node.js 22+ Axios", language: "typescript", file: "request.ts" },
  { id: "python-httpx", label: "Python HTTPX (async)", language: "python", file: "request.py" },
  { id: "csharp", label: "C# HttpClient (.NET 8+)", language: "csharp", file: "Request.cs" },
  { id: "axios", label: "Axios", language: "javascript", file: "request.js" },
  { id: "node-fetch", label: "Node.js 22+ (fetch, TypeScript)", language: "typescript", file: "request.ts" },
  { id: "python", label: "Python requests", language: "python", file: "request.py" },
  { id: "go", label: "Go net/http", language: "go", file: "main.go" },
  { id: "php", label: "PHP (curl)", language: "php", file: "request.php" },
  { id: "java", label: "Java HttpClient", language: "java", file: "Request.java" },
  { id: "dart-http", label: "Dart / Flutter (http)", language: "dart", file: "request.dart" },
  { id: "dart-dio", label: "Dart / Flutter (dio)", language: "dart", file: "request.dart" },
  { id: "kotlin-okhttp", label: "Kotlin / Android (OkHttp)", language: "kotlin", file: "Request.kt" },
  { id: "swift", label: "Swift / iOS (URLSession)", language: "swift", file: "Request.swift" },
  { id: "http", label: "Raw HTTP request", language: "http", file: "request.http" },
  { id: "httpie", label: "HTTPie", language: "shell", file: "request.sh" }
];

export function generateFromCurl(r: CurlRequest, target: CurlTarget, options: CurlGenerateOptions = {}): string {
  if (!CURL_TARGETS.some(t => t.id === target)) throw new ToolInputError("Choose a supported output target.");
  if (options.response && !["auto", "json", "text", "bytes"].includes(options.response)) throw new ToolInputError("Invalid response format.");
  if (r.bodyFile && !["node-fetch", "axios-node", "python", "python-httpx", "csharp", "httpie", "http"].includes(target)) throw new ToolInputError("This target cannot read body files. Use Node.js, Python, C#, HTTPie or raw HTTP, or paste the contents inline.");
  if (r.form.some(f => !f.file && f.contentType) && ["fetch", "fetch-ts", "node-fetch", "axios-node"].includes(target)) throw new ToolInputError("Native FormData cannot preserve a custom content type on text-only fields. Use Python, C# or raw HTTP.");
  if (r.bodyKind === "multipart" && target === "java") throw new ToolInputError("Java HttpClient multipart generation is unsupported. Select Kotlin/OkHttp or another upload-capable target.");
  if ((r.method === "GET" || r.method === "HEAD") && (r.body !== undefined || r.bodyFile || r.form.length) && ["fetch", "fetch-ts", "node-fetch"].includes(target)) throw new ToolInputError("Fetch forbids GET/HEAD request bodies. Use Axios (Node), Python or another compatible target.");
  if (options.reusable && !["fetch", "fetch-ts", "node-fetch"].includes(target)) throw new ToolInputError("Reusable functions are supported by Fetch targets.");
  const repeated = (values: string[]) => new Set(values).size !== values.length;
  if (r.bodyKind === "multipart" && ["php", "dart-http"].includes(target) && repeated(r.form.map(f => f.name))) throw new ToolInputError("This target cannot preserve repeated multipart fields. Use Node.js, Python, C# or Dio.");
  if (r.bodyKind === "multipart" && target === "axios" && r.form.filter(f => f.file).length > 1) throw new ToolInputError("Browser Axios uploads currently require one file. Use browser Fetch or Node.js Axios for multiple files.");
  if (r.form.some(f => f.contentType || f.filename) && ["go", "swift", "kotlin-okhttp", "httpie", "php", "dart-http", "dart-dio", "axios"].includes(target)) throw new ToolInputError("This target does not preserve custom multipart filename/content-type metadata. Use Node.js, Python, C# or Fetch.");
  if (repeated(r.headers.map(([k]) => k.toLowerCase())) && ["axios", "python", "php", "dart-http", "dart-dio", "swift"].includes(target)) throw new ToolInputError("This client target cannot faithfully preserve repeated header names. Use Node.js Fetch, Go, Java or raw HTTP.");
  switch (target) {
    case "fetch": return toFetch(r, false, false, options);
    case "fetch-ts": return toFetch(r, false, true, options);
    case "axios-node": return toAxiosNode(r);
    case "python-httpx": return toPython(r, true);
    case "csharp": return toCSharp(r);
    case "node-fetch": return toFetch(r, true, true, options);
    case "axios": return toAxios(r);
    case "python": return toPython(r);
    case "go": return toGo(r);
    case "php": return toPhp(r);
    case "java": return toJava(r);
    case "dart-http": return toDartHttp(r);
    case "dart-dio": return toDio(r);
    case "kotlin-okhttp": return toOkHttp(r);
    case "swift": return toSwift(r);
    case "http": return toRawHttp(r);
    case "httpie": return toHttpie(r);
  }
}

function toFetch(r: CurlRequest, node: boolean, typed: boolean, options: CurlGenerateOptions): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : []), ...basicHeader(r)];
  const lines: string[] = [], imports: string[] = [];
  const browserFiles = !node && r.form.some(f => f.file);
  const reusable = options.reusable || browserFiles;
  if (node && r.form.some(f => f.file)) imports.push('import { openAsBlob } from "node:fs";');
  if (node && r.bodyFile) imports.push('import { readFile } from "node:fs/promises";');
  if (r.bodyKind === "multipart") {
    lines.push("const form = new FormData();");
    let index = 0;
    for (const f of r.form) {
      if (f.file) {
        const file = node ? `await openAsBlob(${js(f.value)}${f.contentType ? `, { type: ${js(f.contentType)} }` : ""})` : `files[${index}]`;
        if (!node) lines.push(`if (!files[${index}]) throw new Error(${js("Supply a File for multipart field " + f.name)});`);
        lines.push(`form.append(${js(f.name)}, ${file}, ${js(f.filename || f.value.split(/[\\/]/).pop() || "upload")});`); index++;
      } else if (f.contentType) lines.push(`form.append(${js(f.name)}, new Blob([${js(f.value)}], { type: ${js(f.contentType)} }));`);
      else lines.push(`form.append(${js(f.name)}, ${js(f.value)});`);
    }
    lines.push("");
  }
  const opts = [`  method: ${js(r.method)},`, `  redirect: ${js(r.followRedirects ? "follow" : "manual")},`];
  if (headers.length) opts.push(`  headers: [\n${headers.map(([k, v]) => `    [${js(k)}, ${js(v)}],`).join("\n")}\n  ],`);
  if (r.bodyFile) opts.push(`  body: new Uint8Array(await readFile(${js(r.bodyFile)})),`);
  else if (r.body !== undefined) opts.push(r.suppressedHeaders?.some(k => /^content-type$/i.test(k)) ? `  body: new TextEncoder().encode(${js(r.body)}),` : `  body: ${js(r.body)},`);
  else if (r.bodyKind === "multipart") opts.push("  body: form,");
  if (r.timeoutSeconds) opts.push(`  signal: AbortSignal.timeout(${Math.ceil(r.timeoutSeconds * 1000)}),`);
  lines.push(`const response = await fetch(${js(r.url)}, {\n${opts.join("\n")}\n});`, "");
  lines.push('if (response.type === "opaqueredirect") throw new Error("Browser redirect response is opaque. Enable redirects or use a server target.");');
  lines.push('if (response.status >= 400) throw new Error(`HTTP ${response.status}`);');
  if (options.response === "bytes") lines.push("const data = await response.arrayBuffer();");
  else {
    lines.push("const text = await response.text();");
    lines.push(options.response === "text" ? "const data = text;" : `const data = ${options.response === "json" ? 'text ? JSON.parse(text) : undefined' : 'text && /(?:application|text)\\/(?:[\\w.-]+\\+)?json/i.test(response.headers.get("content-type") || "") ? JSON.parse(text) : text'};`);
  }
  if (reusable) {
    lines.push("return data;");
    return `${imports.join("\n")}${imports.length ? "\n\n" : ""}export async function sendRequest(${browserFiles ? `files${typed ? ": readonly File[]" : ""} = []` : ""}) {\n${lines.map(l => l ? "  " + l : l).join("\n")}\n}\n${browserFiles ? "// Call sendRequest with File objects selected by the user, in multipart file order.\n" : ""}`;
  }
  lines.push("console.log(data);");
  return `${imports.join("\n")}${imports.length ? "\n\n" : ""}${lines.join("\n")}\n${typed ? "\nexport {};\n" : ""}`;
}

function toAxios(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : [])];
  const lines = ['import axios from "axios";', ""];
  if (r.bodyKind === "multipart") {
    lines.push("const form = new FormData();");
    for (const f of r.form) lines.push(f.file ? `form.append(${js(f.name)}, file, ${js(f.filename || f.value.split(/[\\/]/).pop() || "upload")});` : `form.append(${js(f.name)}, ${js(f.value)});`);
    lines.push("");
  }
  const opts: string[] = [`  method: ${js(r.method.toLowerCase())},`, `  url: ${js(r.url)},`];
  if (headers.length) opts.push(`  headers: JSON.parse(${js(JSON.stringify(Object.fromEntries(headers)))}),`);
  if (r.basicAuth && !r.headers.some(([k]) => /^authorization$/i.test(k))) opts.push(`  auth: { username: ${js(r.basicAuth.user)}, password: ${js(r.basicAuth.password)} },`);
  if (r.bodyKind === "json") opts.push(`  data: ${js(r.body!)},\n  transformRequest: [data => data],`);
  else if (r.bodyKind === "form") opts.push(`  data: ${js(r.body!)},`);
  else if (r.bodyKind === "raw") opts.push(`  data: ${js(r.body!)},`);
  else if (r.bodyKind === "multipart") opts.push("  data: form,");
  if (r.timeoutSeconds) opts.push(`  timeout: ${r.timeoutSeconds * 1000},`);

  if (r.bodyKind === "multipart" && r.form.some(f => f.file)) lines.splice(2, 0, 'const input = document.querySelector("input[type=file]");\nif (!(input instanceof HTMLInputElement) || !input.files?.[0]) throw new Error("Select an upload file first");\nconst file = input.files[0];', "");
  lines.push(`const { data, status } = await axios.request({\n${opts.join("\n")}\n});`);
  lines.push("console.log(status, data);");
  return lines.join("\n") + "\n";
}

function toPython(r: CurlRequest, httpx = false): string {
  const headers = plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : []);
  const args = [`    ${py(r.method)},`, `    ${py(r.url)},`];
  const setup: string[] = [];
  if (headers.length) args.push(httpx ? `    headers=[${headers.map(([k,v]) => `(${py(k)}, ${py(v)})`).join(", ")}],` : `    headers={${headers.map(([k,v]) => `${py(k)}: ${py(v)}`).join(", ")}},`);
  if (r.bodyFile) args.push(`    ${httpx ? "content" : "data"}=stack.enter_context(open(${py(r.bodyFile)}, "rb")),`);
  else if (r.body !== undefined) args.push(`    ${httpx ? "content" : "data"}=${py(r.body)}.encode("utf-8"),`);
  else if (r.bodyKind === "multipart") {
    // A list preserves duplicate names; (None, value) forces multipart for text-only forms.
    args.push(`    files=[\n${r.form.map(f => `        (${py(f.name)}, (${f.file ? `${py(f.filename || f.value.split(/[\\/]/).pop() || "upload")}, stack.enter_context(open(${py(f.value)}, "rb"))` : `None, ${py(f.value)}`}${f.contentType ? `, ${py(f.contentType)}` : ""})),`).join("\n")}\n    ],`);
  }
  if (r.basicAuth && !r.headers.some(([k]) => /^authorization$/i.test(k))) args.push(`    auth=(${py(r.basicAuth.user)}, ${py(r.basicAuth.password)}),`);
  args.push(`    timeout=${r.timeoutSeconds === 0 ? "None" : r.timeoutSeconds ?? 30},`, `    ${httpx ? "follow_redirects" : "allow_redirects"}=${r.followRedirects ? "True" : "False"},`);
  const context = r.bodyFile || r.form.length ? "with ExitStack() as stack:\n" : "";
  if (context) setup.push("from contextlib import ExitStack");
  const response = `response = ${httpx ? "await client.request" : "requests.request"}(\n${args.join("\n")}\n)\nresponse.raise_for_status()\nprint(response.text)`;
  if (httpx) return `import asyncio\nimport httpx\n${setup.join("\n")}\n\nasync def main():\n    async with httpx.AsyncClient() as client:\n${(context + response.split("\n").map(l => context ? "    " + l : l).join("\n")).split("\n").map(l => "        " + l).join("\n")}\n\nif __name__ == "__main__":\n    asyncio.run(main())\n`;
  return `import requests\n${setup.join("\n")}\n\n${context}${response.split("\n").map(l => context ? "    " + l : l).join("\n")}\n`;
}

function toGo(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : [])];
  const imports = new Set(["fmt", "io", "net/http", "log"]);
  const body: string[] = [];
  let reader = "nil";
  if (r.bodyKind === "json" || r.bodyKind === "raw" || r.bodyKind === "form") {
    imports.add("strings");
    const content = r.body!;
    body.push(`\tbody := strings.NewReader(${goStr(content)})`);
    reader = "body";
  } else if (r.bodyKind === "multipart") {
    imports.add("bytes"); imports.add("mime/multipart");
    if (r.form.some(f => f.file)) { imports.add("os"); imports.add("path/filepath"); }
    body.push("\tvar buf bytes.Buffer", "\tw := multipart.NewWriter(&buf)");
    for (const f of r.form) {
      if (f.file) body.push(`\tif file, err := os.Open(${goStr(f.value)}); err == nil {`, `\t\tpart, err := w.CreateFormFile(${goStr(f.name)}, ${f.filename ? goStr(f.filename) : `filepath.Base(${goStr(f.value)})`})`, "\t\tif err != nil { file.Close(); log.Fatal(err) }", "\t\tif _, err := io.Copy(part, file); err != nil { file.Close(); log.Fatal(err) }", "\t\tfile.Close()", "\t} else {", "\t\tlog.Fatal(err)", "\t}");
      else body.push(`\tif err := w.WriteField(${goStr(f.name)}, ${goStr(f.value)}); err != nil { log.Fatal(err) }`);
    }
    body.push("\tif err := w.Close(); err != nil { log.Fatal(err) }");
    reader = "&buf";
  }
  const lines = [...body, `\treq, err := http.NewRequest(${goStr(r.method)}, ${goStr(r.url)}, ${reader})`, "\tif err != nil {", "\t\tlog.Fatal(err)", "\t}"];
  for (const [k, v] of headers) lines.push(`\treq.Header.Add(${goStr(k)}, ${goStr(v)})`);
  if (r.bodyKind === "multipart") lines.push("\treq.Header.Set(\"Content-Type\", w.FormDataContentType())");
  if (r.basicAuth && !r.headers.some(([k]) => /^authorization$/i.test(k))) lines.push(`\treq.SetBasicAuth(${goStr(r.basicAuth.user)}, ${goStr(r.basicAuth.password)})`);
  if (r.timeoutSeconds) imports.add("time");
  const client = `&http.Client{${r.timeoutSeconds ? `Timeout: ${Math.ceil(r.timeoutSeconds * 1000)} * time.Millisecond, ` : ""}${!r.followRedirects ? "CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }," : ""}}`;
  lines.push(`\tclient := ${client}`, "\tresp, err := client.Do(req)", "\tif err != nil {", "\t\tlog.Fatal(err)", "\t}", "\tdefer resp.Body.Close()", "\tdata, err := io.ReadAll(resp.Body)", "\tif err != nil {", "\t\tlog.Fatal(err)", "\t}", "\tfmt.Println(resp.Status)", "\tfmt.Println(string(data))");
  return `package main\n\nimport (\n${[...imports].sort().map(i => `\t"${i}"`).join("\n")}\n)\n\nfunc main() {\n${lines.join("\n")}\n}\n`;
}

function toPhp(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : [])];
  const lines = ["<?php", "", `$ch = curl_init(${php(r.url)});`, "curl_setopt_array($ch, ["];
  lines.push("    CURLOPT_RETURNTRANSFER => true,");
  lines.push(`    CURLOPT_CUSTOMREQUEST => ${php(r.method)},`);
  if (headers.length) lines.push(`    CURLOPT_HTTPHEADER => [\n${headers.map(([k, v]) => `        ${php(`${k}: ${v}`)},`).join("\n")}\n    ],`);
  if (r.bodyKind === "multipart") lines.push(`    CURLOPT_POSTFIELDS => [\n${r.form.map(f => `        ${php(f.name)} => ${f.file ? `new CURLFile(${php(f.value)})` : php(f.value)},`).join("\n")}\n    ],`);
  else if (r.body !== undefined) lines.push(`    CURLOPT_POSTFIELDS => ${php(r.body)},`);
  if (r.basicAuth) lines.push(`    CURLOPT_USERPWD => ${php(`${r.basicAuth.user}:${r.basicAuth.password}`)},`);
  if (r.followRedirects) lines.push("    CURLOPT_FOLLOWLOCATION => true,");
  if (r.timeoutSeconds) lines.push(`    CURLOPT_TIMEOUT_MS => ${Math.ceil(r.timeoutSeconds * 1000)},`);
  if (r.compressed) lines.push("    CURLOPT_ENCODING => '',");
  lines.push("]);", "$response = curl_exec($ch);", "if ($response === false) {", "    $error = curl_error($ch);", "    curl_close($ch);", "    throw new RuntimeException($error);", "}", "$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);", "curl_close($ch);", "echo $status, PHP_EOL, $response;");
  return lines.join("\n") + "\n";
}

function toJava(r: CurlRequest): string {
  const headers = [...plainHeaders(r), ...basicHeader(r)];
  const publisher = r.bodyKind === "multipart"
    ? "HttpRequest.BodyPublishers.noBody() /* multipart: use a library such as OkHttp or Apache HttpClient */"
    : r.body !== undefined ? `HttpRequest.BodyPublishers.ofString(${java(r.body)})` : "HttpRequest.BodyPublishers.noBody()";
  const lines = [
    "import java.net.URI;",
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "import java.net.http.HttpResponse;",
    "import java.time.Duration;",
    "",
    "public class Request {",
    "    public static void main(String[] args) throws Exception {",
    "        HttpClient client = HttpClient.newBuilder()",
    `            .followRedirects(HttpClient.Redirect.${r.followRedirects ? "NORMAL" : "NEVER"})`,
    `            .connectTimeout(Duration.ofMillis(${Math.ceil((r.connectTimeoutSeconds || 30) * 1000)}))`,
    "            .build();",
    "        HttpRequest request = HttpRequest.newBuilder()",
    `            .uri(URI.create(${java(r.url)}))`,
    ...headers.map(([k, v]) => `            .header(${java(k)}, ${java(v)})`),
    `            .method(${java(r.method)}, ${publisher})`,
    ...(r.timeoutSeconds ? [`            .timeout(Duration.ofMillis(${Math.ceil(r.timeoutSeconds * 1000)}))`] : []),
    "            .build();",
    "        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());",
    "        System.out.println(response.statusCode());",
    "        System.out.println(response.body());",
    "    }",
    "}"
  ];
  return lines.join("\n") + "\n";
}

function toDartHttp(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : []), ...basicHeader(r)];
  const lines = ["import 'package:http/http.dart' as http;", "", "Future<void> main() async {", `  final request = ${r.bodyKind === "multipart" ? "http.MultipartRequest" : "http.Request"}(${dart(r.method)}, Uri.parse(${dart(r.url)}));`, `  request.followRedirects = ${r.followRedirects};`];
  for (const [k,v] of headers) lines.push(`  request.headers[${dart(k)}] = ${dart(v)};`);
  if (r.body !== undefined) lines.push(`  request.body = ${dart(r.body)};`);
  for (const f of r.form) lines.push(f.file ? `  request.files.add(await http.MultipartFile.fromPath(${dart(f.name)}, ${dart(f.value)}${f.filename ? `, filename: ${dart(f.filename)}` : ""}));` : `  request.fields[${dart(f.name)}] = ${dart(f.value)};`);
  lines.push(`  final response = await http.Response.fromStream(await request.send())${r.timeoutSeconds ? `.timeout(const Duration(milliseconds: ${Math.ceil(r.timeoutSeconds * 1000)}))` : ""};`, "  if (response.statusCode >= 400) throw Exception('HTTP ${response.statusCode}');", "  print(response.body);", "}");
  return lines.join("\n") + "\n";
}

function toDio(r: CurlRequest): string {
  const headers = [...plainHeaders(r, ["content-type"]), ...basicHeader(r)];
  const contentType = r.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1];
  const lines = ["import 'package:dio/dio.dart';", "", "Future<void> main() async {", "  final dio = Dio(BaseOptions(", `    connectTimeout: const Duration(milliseconds: ${Math.ceil((r.timeoutSeconds || 30) * 1000)}),`, `    receiveTimeout: const Duration(milliseconds: ${Math.ceil((r.timeoutSeconds || 30) * 1000)}),`, "  ));"];
  let data = "";
  if (r.bodyKind === "json") { lines.push(`  final data = ${dart(r.body!)};`); data = "\n    data: data,"; }
  else if (r.bodyKind === "form") { lines.push(`  final data = ${dart(r.body!)};`); data = "\n    data: data,"; }
  else if (r.bodyKind === "raw") { lines.push(`  final data = ${dart(r.body!)};`); data = "\n    data: data,"; }
  else if (r.bodyKind === "multipart") {
    lines.push("  final data = FormData();");
    for (const f of r.form) lines.push(f.file ? `  data.files.add(MapEntry(${dart(f.name)}, await MultipartFile.fromFile(${dart(f.value)}${f.filename ? `, filename: ${dart(f.filename)}` : ""})));` : `  data.fields.add(MapEntry(${dart(f.name)}, ${dart(f.value)}));`);
    data = "\n    data: data,";
  }
  const ct = r.bodyKind === "form" ? "\n      contentType: Headers.formUrlEncodedContentType," : contentType && r.bodyKind !== "multipart" ? `\n      contentType: ${dart(contentType)},` : "";
  lines.push(`  final response = await dio.request(\n    ${dart(r.url)},${data}\n    options: Options(\n      method: ${dart(r.method)},${headers.length ? `\n      headers: {\n${headers.map(([k, v]) => `        ${dart(k)}: ${dart(v)},`).join("\n")}\n      },` : ""}${ct}${r.followRedirects ? "" : "\n      followRedirects: false,"}\n    ),\n  );`);
  lines.push("  print(response.data);", "}");
  return lines.join("\n") + "\n";
}

function toOkHttp(r: CurlRequest): string {
  const headers = [...plainHeaders(r, ["content-type"]), ...basicHeader(r)];
  const contentType = r.headers.find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? (r.bodyKind === "json" ? "application/json" : "text/plain");
  const imports = new Set(["okhttp3.OkHttpClient", "okhttp3.Request"]);
  const lines: string[] = [];
  let body = "null";
  if (r.bodyKind === "json" || r.bodyKind === "raw" || r.bodyKind === "form") {
    imports.add("okhttp3.MediaType.Companion.toMediaType"); imports.add("okhttp3.RequestBody.Companion.toRequestBody");
    const content = r.body!;
    lines.push(`    val body = ${kotlin(content)}.toRequestBody(${kotlin(contentType)}.toMediaType())`);
    body = "body";
  } else if (r.bodyKind === "multipart") {
    imports.add("okhttp3.MultipartBody"); imports.add("okhttp3.RequestBody.Companion.asRequestBody"); imports.add("java.io.File");
    lines.push("    val body = MultipartBody.Builder()", "        .setType(MultipartBody.FORM)");
    for (const f of r.form) lines.push(f.file ? `        .addFormDataPart(${kotlin(f.name)}, File(${kotlin(f.value)}).name, File(${kotlin(f.value)}).asRequestBody())` : `        .addFormDataPart(${kotlin(f.name)}, ${kotlin(f.value)})`);
    lines.push("        .build()");
    body = "body";
  }
  if (body === "null" && ["POST", "PUT", "PATCH"].includes(r.method)) { imports.add("okhttp3.RequestBody.Companion.toRequestBody"); lines.push('    val body = "".toRequestBody()'); body = "body"; }
  if (r.timeoutSeconds) imports.add("java.util.concurrent.TimeUnit");
  const client = ["    val client = OkHttpClient.Builder()", ...(r.timeoutSeconds ? [`        .callTimeout(${Math.ceil(r.timeoutSeconds * 1000)}L, TimeUnit.MILLISECONDS)`] : []), `        .followRedirects(${r.followRedirects})`, "        .build()"];
  const request = ["    val request = Request.Builder()", `        .url(${kotlin(r.url)})`, ...headers.map(([k, v]) => `        .addHeader(${kotlin(k)}, ${kotlin(v)})`), `        .method(${kotlin(r.method)}, ${body})`, "        .build()"];
  return `${[...imports].sort().map(i => `import ${i}`).join("\n")}\n\n// Run off the main thread on Android (coroutine with Dispatchers.IO, or client.newCall(request).enqueue).\nfun main() {\n${[...client, ...lines, ...request].join("\n")}\n    client.newCall(request).execute().use { response ->\n        if (!response.isSuccessful) error("HTTP \${response.code}: \${response.body?.string()}")\n        println(response.body?.string())\n    }\n}\n`;
}

function toSwift(r: CurlRequest): string {
  const headers = [...plainHeaders(r, r.bodyKind === "multipart" ? ["content-type"] : []), ...basicHeader(r)];
  const lines = ["import Foundation", "", `var request = URLRequest(url: URL(string: ${swift(r.url)})!)`, `request.httpMethod = ${swift(r.method)}`];
  if (r.timeoutSeconds) lines.push(`request.timeoutInterval = ${r.timeoutSeconds}`);
  for (const [k, v] of headers) lines.push(`request.setValue(${swift(v)}, forHTTPHeaderField: ${swift(k)})`);
  if (r.bodyKind === "json") lines.push(`request.httpBody = ${swift(r.body!)}.data(using: .utf8)`);
  else if (r.bodyKind === "form" || r.bodyKind === "raw") lines.push(`request.httpBody = ${swift(r.body!)}.data(using: .utf8)`);
  else if (r.bodyKind === "multipart") {
    lines.push("", "let boundary = \"Boundary-\\(UUID().uuidString)\"", "request.setValue(\"multipart/form-data; boundary=\\(boundary)\", forHTTPHeaderField: \"Content-Type\")", "var body = Data()");
    let fileIndex = 0;
    for (const f of r.form) {
      if (f.file) lines.push(`let fileURL${fileIndex} = URL(fileURLWithPath: ${swift(f.value)})`, "body.append(\"--\\(boundary)\\r\\n\".data(using: .utf8)!)", `body.append("Content-Disposition: form-data; name=\\"${f.name.replace(/"/g, "")}\\"; filename=\\"\\(fileURL${fileIndex}.lastPathComponent)\\"\\r\\n\\r\\n".data(using: .utf8)!)`, `body.append(try Data(contentsOf: fileURL${fileIndex}))`, "body.append(\"\\r\\n\".data(using: .utf8)!)");
      else lines.push("body.append(\"--\\(boundary)\\r\\n\".data(using: .utf8)!)", `body.append("Content-Disposition: form-data; name=\\"${f.name.replace(/"/g, "")}\\"\\r\\n\\r\\n".data(using: .utf8)!)`, `body.append(${swift(f.value + "\r\n")}.data(using: .utf8)!)`);
      if (f.file) fileIndex++;
    }
    lines.push("body.append(\"--\\(boundary)--\\r\\n\".data(using: .utf8)!)", "request.httpBody = body");
  }
  if (!r.followRedirects) lines.push("", "final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate {", "    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }", "}", "let session = URLSession(configuration: .ephemeral, delegate: NoRedirectDelegate(), delegateQueue: nil)", "defer { session.finishTasksAndInvalidate() }");
  lines.push("", `let (data, response) = try await ${r.followRedirects ? "URLSession.shared" : "session"}.data(for: request)`, "guard let http = response as? HTTPURLResponse, (200..<400).contains(http.statusCode) else {", "    throw URLError(.badServerResponse)", "}", "print(String(decoding: data, as: UTF8.self))");
  return lines.join("\n") + "\n";
}

function toRawHttp(r: CurlRequest): string {
  const u = new URL(r.url);
  const lines = [`${r.method} ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`, ...plainHeaders(r).map(([k, v]) => `${k}: ${v}`), ...basicHeader(r).map(([k, v]) => `${k}: ${v}`)];
  if (r.bodyKind === "multipart") lines.push("Content-Type: multipart/form-data; boundary=----devsnip");
  let body = "";
  if (r.bodyFile) body = `< ${r.bodyFile}`;
  else if (r.bodyKind === "json") body = r.body!;
  else if (r.body !== undefined) body = r.body;
  else if (r.bodyKind === "multipart") body = r.form.map(f => `------devsnip\r\nContent-Disposition: form-data; name="${f.name}"${f.file ? `; filename="${(f.filename || f.value.split(/[\\/]/).pop())}"` : ""}${f.contentType ? `\r\nContent-Type: ${f.contentType}` : ""}\r\n\r\n${f.file ? `< ${f.value}` : f.value}`).join("\r\n") + "\r\n------devsnip--";
  return `${lines.join("\n")}\n${body ? `\n${body}\n` : ""}`;
}

function shq(s: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

function toHttpie(r: CurlRequest): string {
  const parts = ["http"];
  if (r.bodyKind === "form" || r.bodyKind === "multipart") parts.push(r.bodyKind === "multipart" ? "--multipart" : "--form");
  if (r.followRedirects) parts.push("--follow");

  if (r.timeoutSeconds) parts.push(`--timeout=${r.timeoutSeconds}`);
  if (r.basicAuth) parts.push(`--auth ${shq(`${r.basicAuth.user}:${r.basicAuth.password}`)}`);
  parts.push(shq(r.method), shq(r.url));
  for (const [k, v] of plainHeaders(r)) parts.push(shq(`${k}:${v}`));
  if (r.bodyKind === "form") for (const [k, v] of formPairs(r.body!)) parts.push(shq(`${k}=${v}`));
  if (r.bodyKind === "multipart") for (const f of r.form) parts.push(shq(f.file ? `${f.name}@${f.value}` : `${f.name}=${f.value}`));
  const prefix = r.bodyFile ? `cat -- ${shq(r.bodyFile)} | ` : r.bodyKind === "json" || r.bodyKind === "raw" ? `printf %s ${shq(r.body!)} | ` : "";
  return `${prefix}${parts.join(" ")}\n`;
}

/** Back to a clean, canonical cURL command (one option per line). */
export function toCurl(r: CurlRequest): string {
  const parts = [`curl${r.followRedirects ? " -L" : ""}${r.insecure ? " -k" : ""}${r.compressed ? " --compressed" : ""} -X ${shq(r.method)} ${shq(r.url)}`];
  for (const [k, v] of r.headers) parts.push(`-H ${shq(v ? `${k}: ${v}` : `${k};`)}`);
  for (const name of r.suppressedHeaders ?? []) parts.push(`-H ${shq(name + ":")}`);
  if (r.basicAuth) parts.push(`-u ${shq(`${r.basicAuth.user}:${r.basicAuth.password}`)}`);
  if (r.bodyFile) parts.push(`--data-binary ${shq("@" + r.bodyFile)}`);
  else if (r.bodyKind === "json") parts.push(`--data-raw ${shq(r.body!)}`);
  else if (r.body !== undefined) parts.push(`--data-raw ${shq(r.body)}`);
  for (const f of r.form) parts.push(`${f.file || f.contentType || f.filename ? "-F" : "--form-string"} ${shq(`${f.name}=${f.file ? "@" : ""}${f.value}${f.contentType ? ";type=" + f.contentType : ""}${f.filename ? ";filename=" + f.filename : ""}`)}`);
  if (r.timeoutSeconds !== undefined) parts.push(`--max-time ${r.timeoutSeconds}`);
  if (r.connectTimeoutSeconds !== undefined) parts.push(`--connect-timeout ${r.connectTimeoutSeconds}`);
  if (r.proxy) parts.push(`--proxy ${shq(r.proxy)}`);
  return parts.join(" \\\n  ") + "\n";
}

/** Notes worth knowing before running the converted request. */
export function curlWarnings(r: CurlRequest): string[] {
  const out: string[] = [...(r.warnings ?? [])];
  const auth = r.headers.find(([k]) => /^(authorization|x-api-key|api-key|x-auth-token)$/i.test(k));
  if (auth || r.basicAuth) out.push("The request carries credentials. Move them to environment variables or secure storage before committing the code.");
  if (r.headers.some(([k]) => k.toLowerCase() === "cookie")) out.push("A Cookie header was copied from the browser; session cookies expire, so replace it with a real login flow in code.");
  if (r.insecure) out.push("curl -k disables TLS certificate checks. Generated clients keep verification on; fix the certificate instead. Normalized cURL retains -k.");
  if (r.proxy) out.push("The request specifies a proxy. Configure it in the generated client; only normalized cURL preserves the proxy setting.");
  if (r.url.startsWith("http://") && !/\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0|192\.168\.|10\.)/.test(r.url)) out.push("Plain http:// is blocked by default on Android 9+ and by App Transport Security on iOS; use https.");
  const browserNoise = r.headers.filter(([k]) => /^(sec-|priority$|upgrade-insecure-requests$|dnt$|pragma$)/i.test(k));
  if (browserNoise.length) out.push(`Browser-only headers can usually be dropped: ${browserNoise.map(([k]) => k).join(", ")}.`);
  if (r.suppressedHeaders?.length) out.push(`Suppressed headers: ${r.suppressedHeaders.join(", ")}. Some HTTP clients add default headers; verify those defaults when exact suppression matters.`);
  if (r.connectTimeoutSeconds !== undefined) out.push("Connect timeout is separate from total timeout; some targets require manual client configuration.");
  if (r.bodyFile) out.push("The body references a local file. It is not read by the converter; generated code reads it when run.");
  if (r.headers.some(([k]) => /^authorization$|^cookie$/i.test(k)) && r.followRedirects) out.push("Review cross-origin redirects before forwarding credentials; client redirect policies differ.");
  if (/[\$`]/.test(r.url + (r.body ?? ""))) out.push("Shell variables and substitutions are retained literally; the converter never evaluates them.");
  if (r.ignored.length) out.push(`Ignored options: ${r.ignored.join(", ")}.`);
  return out;
}

/** Target-specific differences that cannot be represented by a portable snippet. */
export function curlTargetWarnings(r: CurlRequest, target: CurlTarget): string[] {
  const warnings: string[] = [];
  if (["fetch", "fetch-ts", "axios"].includes(target)) {
    const forbidden = r.headers.filter(([k]) => /^(cookie|host|content-length|origin|referer|connection|accept-encoding|sec-)/i.test(k));
    if (forbidden.length) warnings.push(`Browsers control these headers: ${forbidden.map(([k]) => k).join(", ")}. Use a server target when exact header control is required.`);
    warnings.push("Browser requests are subject to CORS. Redirect and credential behavior is controlled by the browser.");
  }
  if (target === "httpie") warnings.push("HTTPie form values are re-encoded; use normalized cURL or raw HTTP when byte-for-byte body fidelity matters.");
  if (target === "dart-http" && r.timeoutSeconds) warnings.push("Dart Future.timeout stops waiting but does not abort the underlying request. Use a client with cancellation for strict deadlines.");
  return warnings;
}
