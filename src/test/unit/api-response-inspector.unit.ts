import * as assert from "assert";
import * as ts from "typescript";
import * as vm from "vm";
import { inspectApiResponse as legacyInspect } from "../../toolkits/engines/data-inspect";
import { inspectApiResponse } from "../../toolkits/engines/api-response";
import { apiFields, apiJsonPointer, formatApiJson, parseApiJson } from "../../toolkits/engines/api-response-json";
import { apiAssertions, apiReportJson, apiReportMarkdown, compareApiResponses, inferApiTypes, normalizedApiResponse } from "../../toolkits/engines/api-response-tools";
import { apiResponse } from "../../toolkits/sections/api-response";
import { ToolContext, ToolInputError } from "../../toolkits/types";
import { suite, test } from "./run-unit-tests";

const response = (body: string, headers = "Content-Type: application/json", status = "200 OK") => `HTTP/1.1 ${status}\r\n${headers}\r\n\r\n${body}`;
const notes = (raw: string) => inspectApiResponse(raw).diagnostics.map(d => d.message).join("\n");
function har(text?: string, encoding?: string) {return JSON.stringify({log:{version:"1.2",entries:[{time:12.5,request:{method:"GET",url:"https://example.com?token=SECRET"},response:{status:200,statusText:"OK",httpVersion:"HTTP/2",headers:[{name:"Set-Cookie",value:"sid=SECRET; Secure; HttpOnly"},{name:"Set-Cookie",value:"other=two; Secure"}],content:{mimeType:"application/json",...(text !== undefined ? {text} : {}),...(encoding ? {encoding} : {})}}}]}});}

suite("API response inspector: transport", () => {
  test("preserves the original entry point and exact whitespace/newlines in body bytes", () => {
    const body = "  {\r\n \"id\":1\r\n}\r\n  ";
    const r = legacyInspect(response(body));
    assert.strictEqual(r.bodyText,body);
    assert.strictEqual(r.bytes,Buffer.byteLength(body));
    assert.strictEqual(r.status,200); assert.strictEqual(r.isJson,true);
    assert.deepStrictEqual(r.body,{id:1});
  });
  test("recognizes informational, proxy and redirect header chains and inspects the final block", () => {
    const raw = "HTTP/1.1 200 Connection established\r\n\r\nHTTP/1.1 100 Continue\r\n\r\nHTTP/2 302\r\nLocation: /next\r\n\r\nHTTP/3 200\r\nContent-Type: application/json\r\n\r\n{\"ok\":true}";
    const r = inspectApiResponse(raw);
    assert.strictEqual(r.chain.length,4); assert.strictEqual(r.status,200); assert.strictEqual(r.protocol,"3"); assert.deepStrictEqual(r.body,{ok:true});
    const text = inspectApiResponse(response("HTTP/1.1 404 is just body text","Content-Type: text/plain"));
    assert.strictEqual(text.chain.length,1); assert.strictEqual(text.bodyText,"HTTP/1.1 404 is just body text");
  });
  test("retains duplicate cookies and reports malformed/folded headers", () => {
    const r = inspectApiResponse("HTTP/2 200\nSet-Cookie: a=1; Secure\nSet-Cookie: b=2; Secure\nX-Test: one\n two\n\n{}");
    assert.strictEqual(r.cookies.length,2); assert.strictEqual(r.headers[2][1],"one two");
    assert.ok(r.diagnostics.some(d => d.message.includes("folded")));
    assert.ok(inspectApiResponse("HTTP/1.1 200 OK\nBad header\n\nbody").diagnostics.some(d => d.severity === "error"));
    assert.throws(() => inspectApiResponse("HTTP/1.1 999 invalid\n\nbody"),ToolInputError);
  });
  test("supports header-only captures and explicit plain-body override", () => {
    const r = inspectApiResponse("Content-Type: application/json\nX-Test: yes\n\n{}",{mode:"http"});
    assert.strictEqual(r.headers.length,2); assert.strictEqual(r.status,undefined); assert.strictEqual(r.isJson,true);
    assert.strictEqual(inspectApiResponse("HTTP/2 200",{mode:"body",format:"text"}).bodyText,"HTTP/2 200");
  });
  test("loads HAR metadata and UTF-8 base64 text, and reports absent/binary bodies", () => {
    const r = inspectApiResponse(har(Buffer.from('{"id":1}').toString("base64"),"base64"));
    assert.strictEqual(r.source,"har"); assert.strictEqual(r.durationMs,12.5); assert.strictEqual(r.requestMethod,"GET"); assert.deepStrictEqual(r.body,{id:1});
    assert.strictEqual(r.headers.filter(([k]) => k === "Set-Cookie").length,2);
    assert.ok(inspectApiResponse(har()).diagnostics.some(d => d.message.includes("omits")));
    assert.strictEqual(inspectApiResponse(har("/w==","base64")).format,"binary");
    assert.throws(() => inspectApiResponse(har("???","base64")),ToolInputError);
    assert.throws(() => inspectApiResponse(har("{}"),{harIndex:1}),ToolInputError);
  });
  test("rejects invalid options and enforces capture/header/depth limits", () => {
    for (const options of [{mode:"bad"},{format:"bad"}]) assert.throws(() => inspectApiResponse("{}",options as never),ToolInputError);
    assert.throws(() => inspectApiResponse("a".repeat(2 * 1024 * 1024 + 1)),ToolInputError);
    assert.throws(() => inspectApiResponse("[".repeat(65) + "0" + "]".repeat(65)),ToolInputError);
    assert.throws(() => inspectApiResponse("HTTP/2 200\n" + Array(1001).fill("X: a\n").join("") + "\nbody"),ToolInputError);
  });
});

suite("API response inspector: content and diagnostics", () => {
  test("lossless JSON formatting preserves large integers, duplicate keys and literal string whitespace", () => {
    const source = '{"id":9007199254740993,"id":1,"value":" a\\n b ","empty":{}}';
    const r = inspectApiResponse(source);
    const pretty = formatApiJson(source), compact = formatApiJson(pretty,true);
    assert.ok(pretty.includes("9007199254740993")); assert.strictEqual(compact,source);
    assert.ok(r.diagnostics.some(d => d.message.includes("duplicate object keys")));
    assert.ok(r.diagnostics.some(d => d.message.includes("safe numeric range")));
  });
  test("reports invalid declared JSON without echoing potentially sensitive source text", () => {
    const r = inspectApiResponse(response('{"SECRET":oops}'));
    assert.strictEqual(r.isJson,false); assert.ok(r.diagnostics.some(d => d.severity === "error"));
    assert.ok(!JSON.stringify(r.diagnostics).includes("SECRET")); assert.strictEqual(r.bodyText,'{"SECRET":oops}');
  });
  test("classifies scalars, forms, HTML/XML and UTF-8 body size", () => {
    for (const scalar of ["null","false","42",'"hello"']) assert.ok(inspectApiResponse(scalar).isJson);
    assert.strictEqual(inspectApiResponse(response("x=one&x=two","Content-Type: application/x-www-form-urlencoded")).format,"form");
    assert.strictEqual(inspectApiResponse(response("<html><script>alert(1)</script></html>","Content-Type: text/html")).format,"html");
    assert.strictEqual(inspectApiResponse(response("<?xml version=\"1.0\"?><x/>","Content-Type: application/xml")).format,"xml");
    assert.strictEqual(inspectApiResponse("café",{format:"text"}).bytes,5);
    assert.strictEqual(inspectApiResponse("word 1 ".repeat(30000),{format:"auto"}).format,"text");
  });
  test("handles NDJSON valid/invalid lines and SSE event dispatch, multiline data, IDs and retry", () => {
    const nd = inspectApiResponse('{"a":1}\nnot-json\n{"b":2}\n',{format:"ndjson"});
    assert.strictEqual((nd.body as unknown[]).length,2); assert.ok(nd.diagnostics.some(d => d.message.includes("Line 2")));
    const sse = inspectApiResponse("id: 1\nretry: 2000\nevent: update\ndata: first\ndata: second\n\ndata: pending",{format:"sse"});
    assert.deepStrictEqual(sse.body,[{event:"update",id:"1",data:"first\nsecond",retry:2000}]);
    assert.ok(sse.diagnostics.some(d => d.message.includes("unfinished")));
    assert.strictEqual((inspectApiResponse("data: one\n\n",{format:"sse"}).body as unknown[]).length,1);
  });
  test("distinguishes no-cache/no-store and avoids content-length false positives for HEAD/304/compression", () => {
    assert.ok(notes(response("{}","Cache-Control: no-cache")).includes("permits storage"));
    assert.ok(notes(response("{}","Cache-Control: no-store")).includes("prohibits storing"));
    assert.ok(notes(response("x","Content-Length: 5","200 OK")).includes("declares 5 bytes"));
    for (const status of ["204 No Content","304 Not Modified"]) assert.ok(!notes(response("","Content-Length: 500",status)).includes("declares 500 bytes"));
    assert.ok(!inspectApiResponse(response("","Content-Length: 500"),{requestMethod:"HEAD"}).insights.some(s => s.includes("declares 500 bytes")));
    assert.ok(!notes(response("{}","Content-Length: 500\r\nContent-Encoding: gzip")).includes("declares 500 bytes"));
    assert.ok(notes(response("{}","Content-Length: 1\r\nContent-Length: 2")).includes("Conflicting Content-Length"));
  });
  test("handles quoted cache field lists and rejects decimal Retry-After as a date", () => {
    const r = inspectApiResponse(response("{}",'Cache-Control: private="set-cookie, authorization", max-age=60\r\nRetry-After: 1.5'));
    assert.strictEqual(r.cache.length,2);
    assert.strictEqual(r.cache[0][0],"private");
    assert.ok(r.insights.some(s => s.includes("neither integer seconds")));
    assert.ok(notes(response("{}","Cache-Control: max-age=-1")).includes("nonnegative integer"));
  });
  test("bounds pathological headers and long property paths without losing source captures", () => {
    const header = "<".repeat(70000);
    const r = inspectApiResponse(response("{}",`Link: ${header}`));
    assert.ok(r.diagnostics.some(d => d.message.includes("64 KiB")));
    assert.strictEqual(r.headers[0][1],header);
    const key = "k".repeat(600), before = inspectApiResponse(JSON.stringify({[key]:1})), after = inspectApiResponse(JSON.stringify({[key]:2}));
    assert.ok(before.truncatedFields); assert.ok(compareApiResponses(before,after).truncated);
  });
  test("SSE snapshots accept a leading BOM and redact JSON secrets", () => {
    const r = inspectApiResponse('\uFEFFdata: {"token":"SECRET"}\n\n',{format:"sse",redact:true});
    assert.strictEqual((r.body as unknown[]).length,1);
    assert.ok(!apiReportJson(r).includes("SECRET"));
  });
  test("explains retry dates, zero rate limits, mixed-case Link pagination and GraphQL/Problem Details", () => {
    const r = inspectApiResponse(response("{}",'Retry-After: Tue, 03 Nov 2026 12:00:30 GMT\r\nRateLimit-Remaining: 0\r\nLink: <https://example.com/p?a=1,2>; REL="next last"'),{now:new Date("2026-11-03T12:00:00Z")});
    assert.ok(r.insights.some(s => s.includes("30 seconds"))); assert.deepStrictEqual(r.rateLimits,[["ratelimit-remaining","0"]]); assert.ok(r.links.some(l => l.relation === "next"));
    assert.ok(notes(response('{"data":null,"errors":[{"message":"denied"}]}')).includes("GraphQL"));
    assert.ok(notes(response('{"status":400}',"Content-Type: application/problem+json","422 Unprocessable Content")).includes("HTTP status takes precedence"));
  });
});

suite("API response inspector: exploration and exports", () => {
  test("JSON Pointer supports escaped names and own properties while rejecting inherited/invalid paths", () => {
    const value = parseApiJson('{"a/b":{"~key":[{"__proto__":"own"}]}}').value;
    assert.strictEqual(apiJsonPointer(value,"/a~1b/~0key/0/__proto__"),"own");
    assert.throws(() => apiJsonPointer({},"/constructor"),ToolInputError);
    assert.throws(() => apiJsonPointer([],"/01"),ToolInputError);
    assert.throws(() => apiJsonPointer(value,"/bad~2"),ToolInputError);
    assert.throws(() => apiJsonPointer(value,"a"),ToolInputError);
  });
  test("fields explore multiple array items and remain bounded", () => {
    const r = inspectApiResponse('[{"id":1},{"name":"Ada"}]');
    assert.ok(r.fields.some(f => f.pointer === "/1/name"));
    const bounded = apiFields(Array.from({length:100},(_,id) => ({id})),10);
    assert.strictEqual(bounded.fields.length,10); assert.ok(bounded.truncated);
  });
  test("comparison ignores configured header names/casing, respects array order and catches added/null values", () => {
    const a = inspectApiResponse(response('{"a":null,"items":[1,2]}',"Content-Type: application/json\r\nDate: old"));
    const b = inspectApiResponse(response('{"a":false,"items":[2,1],"new":1}',"content-type: application/json\r\ndate: new"));
    const diff = compareApiResponses(a,b);
    assert.ok(!diff.changes.some(d => d.path.startsWith("headers")));
    assert.ok(diff.changes.some(d => d.path === "body/a" && d.kind === "type"));
    assert.ok(diff.changes.some(d => d.path === "body/new" && d.kind === "added"));
    assert.ok(compareApiResponses(inspectApiResponse('{"n":9007199254740992}'),inspectApiResponse('{"n":9007199254740993}')).changes.some(d => d.path === "body source"));
  });
  test("inferred root arrays merge optional fields; generated TypeScript has no missing local types", () => {
    const r = inspectApiResponse('[{"id":1},{"id":"two","name":null}]');
    const inferred = inferApiTypes(r);
    assert.ok(inferred.typescript.includes('"name"?: null'));
    const file = ts.createSourceFile("types.ts",inferred.typescript,ts.ScriptTarget.ES2020,true);
    const output = ts.transpileModule(inferred.typescript,{reportDiagnostics:true,compilerOptions:{strict:true,target:ts.ScriptTarget.ES2020}});
    assert.deepStrictEqual(output.diagnostics,[]); assert.ok(file.statements.length > 0);
    const schema = JSON.parse(inferred.schema); assert.strictEqual(schema.type,"array"); assert.ok(!Object.prototype.hasOwnProperty.call(schema.items,"additionalProperties"));
    const dangerous = JSON.parse(inferApiTypes(inspectApiResponse('{"__proto__":{"polluted":true}}')).schema);
    assert.ok(Object.prototype.hasOwnProperty.call(dangerous.properties,"__proto__")); assert.strictEqual(({} as {polluted?:boolean}).polluted,undefined);
  });
  test("redaction removes credentials across HAR metadata, chains, cookies, URLs and nested JSON, preserving big integers", () => {
    const r = inspectApiResponse(har('{"token":"SECRET","n":9007199254740993}'),{redact:true});
    assert.ok(!apiReportJson(r).includes("SECRET")); assert.ok(r.bodyText.includes("9007199254740993"));
    assert.ok(!apiReportMarkdown(r).includes("SECRET")); assert.ok(normalizedApiResponse(r).includes("REDACTED"));
  });
  test("report exports are parseable; reconstructed captures remove stale wire encoding/framing", () => {
    const r = inspectApiResponse(response('{"n":1}',"Content-Type: application/json\r\nContent-Length: 500\r\nContent-Encoding: gzip\r\nTransfer-Encoding: chunked"));
    assert.strictEqual(JSON.parse(apiReportJson(r)).bodyText,'{"n":1}');
    const raw = normalizedApiResponse(r); assert.ok(!/Content-Length|Content-Encoding|Transfer-Encoding/i.test(raw)); assert.strictEqual(inspectApiResponse(raw).bodyText,r.bodyText);
    assert.ok(apiReportMarkdown(inspectApiResponse('```\nunsafe fence\n```',{format:"text"})).includes("````text"));
  });
  test("assertion helper executes against a mocked Response without sending requests", async () => {
    const source = apiAssertions(inspectApiResponse(response('{"ok":true}')),"vitest");
    const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    const exported: {assertApiResponse?: (r: Response) => Promise<void>} = {};
    const expect = (actual: unknown) => ({toBe:(expected: unknown) => assert.strictEqual(actual,expected),toBeNull:() => assert.strictEqual(actual,null)});
    vm.runInNewContext(compiled,{exports:exported,require:() => ({expect})});
    await exported.assertApiResponse!(new Response('{"ok":true}',{status:200,headers:{"Content-Type":"application/json"}}));
    await assert.rejects(() => exported.assertApiResponse!(new Response("no",{status:500})),assert.AssertionError);
  });
});

suite("API response inspector: workbench", () => {
  test("all presets and export modes produce results and unique file names", async () => {
    const defaults = Object.fromEntries(apiResponse.fields.filter(f => f.default !== undefined).map(f => [f.id,f.default!]));
    for (const example of apiResponse.examples!) await apiResponse.run({...defaults,...example.values},{});
    for (const mode of ["json","markdown","http","typescript","schema","tests","all"]) {
      const result = await apiResponse.run({raw:response('{"id":1}'),export:mode},{});
      const files = result.outputs!.filter(o => o.kind === "code");
      assert.strictEqual(new Set(files.map(o => o.kind === "code" ? o.fileName : "")).size,files.length);
    }
  });
  test("saved presets redact both comparison inputs and are cleared without needing response text", async () => {
    let saved: unknown = [];
    const context: ToolContext = {storage:{get:<T>(_key:string,fallback:T) => saved as T ?? fallback,set:async (_key,value) => {saved=value;}}};
    await apiResponse.run({raw:response('{"token":"SECRET"}'),baseline:response('{"password":"SECRET"}'),view:"compare"},context,"save-preset");
    assert.ok(!JSON.stringify(saved).includes("SECRET")); assert.strictEqual((await apiResponse.dynamicExamples!(context)).length,1);
    await apiResponse.run({},context,"clear-presets"); assert.deepStrictEqual(saved,[]);
    assert.ok(apiResponse.fields.find(f => f.id === "raw")!.sensitive); assert.ok(apiResponse.fields.find(f => f.id === "baseline")!.sensitive);
  });
  test("file loading uses the selected UTF-8 capture and rejects binary files", async () => {
    const context: ToolContext = {files:{pick:async () => ({name:"response.json",path:"/response.json",bytes:new TextEncoder().encode('{"id":1}')}),save:async () => undefined}};
    const result = await apiResponse.run({},context,"load-file"); assert.strictEqual(result.setValues?.raw,'{"id":1}');
    context.files!.pick = async () => ({name:"binary",path:"/binary",bytes:new Uint8Array([255])});
    await assert.rejects(async () => apiResponse.run({},context,"load-file"),ToolInputError);
  });
});
