"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.curlCSharp = exports.curlAxiosNode = void 0;
const q = JSON.stringify;
function curlAxiosNode(r) {
    var _a;
    const imports = ['import axios from "axios";'];
    const setup = [];
    let body = r.body === undefined ? undefined : q(r.body);
    if (r.bodyFile) {
        imports.push('import { readFile } from "node:fs/promises";');
        body = `await readFile(${q(r.bodyFile)})`;
    }
    if (r.bodyKind === "multipart") {
        body = "form";
        setup.push("const form = new FormData();");
        if (r.form.some(f => f.file))
            imports.push('import { openAsBlob } from "node:fs";');
        for (const f of r.form)
            setup.push(f.file
                ? `form.append(${q(f.name)}, await openAsBlob(${q(f.value)}${f.contentType ? `, { type: ${q(f.contentType)} }` : ""}), ${q(f.filename || f.value.split(/[\\/]/).pop() || "upload")});`
                : f.contentType ? `form.append(${q(f.name)}, new Blob([${q(f.value)}], { type: ${q(f.contentType)} }));` : `form.append(${q(f.name)}, ${q(f.value)});`);
    }
    const grouped = Object.create(null);
    for (const [k, v] of r.headers) {
        if (/^(host|content-length)$/i.test(k))
            continue;
        (grouped[_a = k.toLowerCase()] ?? (grouped[_a] = [])).push(v);
    }
    const options = [`  url: ${q(r.url)},`, `  method: ${q(r.method)},`, `  headers: JSON.parse(${q(JSON.stringify(grouped))}),`, `  timeout: ${r.timeoutSeconds === undefined ? 30000 : Math.ceil(r.timeoutSeconds * 1000)},`, `  maxRedirects: ${r.followRedirects ? 10 : 0},`, "  validateStatus: status => status < 400,"];
    if (r.basicAuth && !r.headers.some(([k]) => /^authorization$/i.test(k)))
        options.push(`  auth: { username: ${q(r.basicAuth.user)}, password: ${q(r.basicAuth.password)} },`);
    if (body !== undefined) {
        options.push(`  data: ${body},`);
        if (r.bodyKind !== "multipart")
            options.push("  transformRequest: [data => data],");
    }
    return `${imports.join("\n")}\n\n${setup.join("\n")}\nconst response = await axios.request({\n${options.join("\n")}\n});\nconsole.log(response.status, response.data);\n`;
}
exports.curlAxiosNode = curlAxiosNode;
function curlCSharp(r) {
    const lines = ["using System;", "using System.IO;", "using System.Net.Http;", "using System.Text;", "", `using var handler = new HttpClientHandler { AllowAutoRedirect = ${r.followRedirects} };`, "using var client = new HttpClient(handler);", `client.Timeout = ${r.timeoutSeconds === 0 ? "System.Threading.Timeout.InfiniteTimeSpan" : `TimeSpan.FromSeconds(${r.timeoutSeconds ?? 30})`};`, `using var request = new HttpRequestMessage(new HttpMethod(${q(r.method)}), ${q(r.url)});`];
    if (r.bodyFile)
        lines.push(`request.Content = new StreamContent(File.OpenRead(${q(r.bodyFile)}));`);
    else if (r.body !== undefined)
        lines.push(`request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(${q(r.body)}));`);
    else if (r.bodyKind === "multipart") {
        lines.push("var form = new MultipartFormDataContent();", "request.Content = form;");
        r.form.forEach((f, i) => {
            lines.push(`var part${i} = ${f.file ? `new StreamContent(File.OpenRead(${q(f.value)}))` : `new StringContent(${q(f.value)}, Encoding.UTF8)`};`);
            if (f.contentType)
                lines.push(`part${i}.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(${q(f.contentType)});`);
            lines.push(`form.Add(part${i}, ${q(f.name)}${f.file ? `, ${q(f.filename || f.value.split(/[\\/]/).pop() || "upload")}` : ""});`);
        });
    }
    for (const [k, v] of r.headers) {
        if (/^(host|content-length)$/i.test(k))
            continue;
        lines.push(`if (!request.Headers.TryAddWithoutValidation(${q(k)}, ${q(v)})) {`, "    request.Content ??= new ByteArrayContent(Array.Empty<byte>());", `    request.Content.Headers.TryAddWithoutValidation(${q(k)}, ${q(v)});`, "}");
    }
    if (r.basicAuth && !r.headers.some(([k]) => /^authorization$/i.test(k)))
        lines.push(`request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(${q(`${r.basicAuth.user}:${r.basicAuth.password}`)})));`);
    lines.push("using var response = await client.SendAsync(request);", "response.EnsureSuccessStatusCode();", "Console.WriteLine(await response.Content.ReadAsStringAsync());");
    return lines.join("\n") + "\n";
}
exports.curlCSharp = curlCSharp;
//# sourceMappingURL=curl-targets.js.map