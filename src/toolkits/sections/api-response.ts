import { inspectApiResponse, ApiInspectOptions } from "../engines/api-response";
import { API_MAX_INPUT, apiJsonPointer, apiSecretHeader, formatApiJson } from "../engines/api-response-json";
import { apiAssertions, apiReportJson, apiReportMarkdown, compareApiResponses, inferApiTypes, normalizedApiResponse } from "../engines/api-response-tools";
import { Output, ToolExample, ToolInputError, ToolSpec, Values, bool, fmtBytes, num, str } from "../types";
import { code, f, opts, table } from "./helpers";

const sample = 'HTTP/1.1 429 Too Many Requests\nContent-Type: application/json\nRetry-After: 30\nX-RateLimit-Remaining: 0\n\n{"error":{"code":"rate_limited","message":"Slow down"},"requestId":"req_123"}';
const storageKey = "apiResponseInspector.presets.v1";
export const apiResponse: ToolSpec = {
  id: "web.api-response", command: "apiResponseInspector", title: "API Response Inspector", icon: "api", live: true, runLabel: "Inspect response",
  summary: "Inspect HTTP, HAR, JSON and streaming captures; explore fields, compare responses, explain headers and errors, and export reports, types or schemas.",
  guide: "Runs locally: no requests, script execution or external links are opened. Paste raw HTTP, a body, or a HAR file. Consecutive interim/redirect/proxy header blocks are recognized; inspection targets the final response. JSON previews preserve source numbers and duplicate keys. Fields/types/comparisons use parsed values and bounded sampling. Binary compression and chunk framing are not decoded. Input is excluded from saved panel state. Enable redaction before sharing exports; known credentials are always redacted in saved presets. Reports describe the capture, not a complete security audit or API contract.",
  keywords: ["http response", "headers", "status code", "rest", "curl -i", "pagination", "cache-control", "har", "ndjson", "server-sent events", "graphql", "problem details", "json pointer", "response diff", "json schema", "typescript"],
  fields: [
    f.select("view", "Workflow", opts(["inspect","Inspect response"],["compare","Compare two responses"])),
    f.select("inputMode", "Input format", opts(["auto","Detect HTTP / HAR / body"],["http","HTTP response or headers + body"],["body","Body only"],["har","HAR v1.2"])),
    f.code("raw", "Response", "http", { rows:12, required:true, sensitive:true, fromEditor:true, default:sample }),
    f.code("baseline", "Baseline response", "http", { rows:9, sensitive:true, fromEditor:true, required:true, showIf:{field:"view",equals:["compare"]}, default:'HTTP/1.1 200 OK\nContent-Type: application/json\n\n{"id":1,"name":"Ada"}' }),
    f.text("ignoreHeaders", "Ignore comparison headers", {default:"Date, Age, Server-Timing",showIf:{field:"view",equals:["compare"]},help:"Comma-separated names; repeated header values and array order are compared."}),
    f.select("format", "Body format", opts(["auto","Detect from content and headers"],["json","JSON"],["ndjson","NDJSON / JSON Lines"],["sse","Server-sent events"],["text","Plain text"])),
    f.num("harIndex", "HAR entry index (starts at 0)", 0, {min:0,max:10000,step:1,showIf:{field:"inputMode",equals:["har"]}}),
    f.select("method", "Request method (when known)",opts(["unknown","Unknown / use HAR method"],"GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS")),
    f.select("bodyView", "Body preview",opts(["pretty","Pretty JSON"],["raw","Original captured text"],["compact","Compact JSON"])),
    f.text("pointer", "JSON Pointer",{placeholder:"/data/0/id",help:"Optional structured-body selection. Use ~1 for / and ~0 for ~ in property names."}),
    f.text("search", "Search fields / headers",{placeholder:"name, /data, content-type…",help:"Case-insensitive literal search; affects tables, not exported reports or body text."}),
    f.num("maxFields", "Maximum fields", 200, {min:1,max:1000,step:1}),
    f.toggle("redact", "Redact known secrets in outputs",false,{help:"Masks credential headers, query parameters and JSON/form secrets. Opaque bodies are replaced; review custom secrets and personal data."}),
    f.select("export", "Extra exports",opts(["none","Inspection only"],["json","JSON inspection report"],["markdown","Markdown report"],["http","Reconstructed response"],["typescript","TypeScript type"],["schema","JSON Schema"],["tests","Response assertion helper"],["all","All exports"]),{searchable:true}),
    f.text("typeName", "Type name",{default:"ApiResponse",showIf:{field:"export",equals:["typescript","schema","all"]}}),
    f.select("testRunner", "Assertion runner",opts(["vitest","Vitest"],["jest","Jest"]),{showIf:{field:"export",equals:["tests","all"]}}),
    f.text("presetName", "Preset name (optional)",{placeholder:"Users response"})
  ],
  examples: [
    {label:"Rate limit + retry guidance",values:{raw:sample,view:"inspect",inputMode:"auto",format:"auto"}},
    {label:"Interim response + final JSON",values:{raw:'HTTP/1.1 100 Continue\r\n\r\nHTTP/2 201\r\nContent-Type: application/json\r\nLocation: /users/42\r\n\r\n{"id":42,"name":"Ada"}',view:"inspect",inputMode:"auto",format:"auto"}},
    {label:"Problem Details",values:{raw:'HTTP/1.1 422 Unprocessable Content\nContent-Type: application/problem+json\n\n{"type":"https://example.com/problems/validation","title":"Invalid input","status":422,"detail":"Check required fields."}',view:"inspect",inputMode:"auto",format:"auto"}},
    {label:"GraphQL errors under HTTP 200",values:{raw:'HTTP/2 200\nContent-Type: application/json\n\n{"data":null,"errors":[{"message":"Permission denied","path":["account"]}]}',view:"inspect",inputMode:"auto",format:"auto"}},
    {label:"Mixed array fields",values:{raw:'[{"id":1,"name":"Ada"},{"id":2,"active":true},{"id":"external","name":null}]',view:"inspect",inputMode:"body",format:"auto"}},
    {label:"NDJSON snapshot",values:{raw:'HTTP/2 200\nContent-Type: application/x-ndjson\n\n{"id":1}\n{"id":2,"name":"Ada"}\n',view:"inspect",inputMode:"auto",format:"auto"}},
    {label:"Server-sent events snapshot",values:{raw:'HTTP/2 200\nContent-Type: text/event-stream\n\nid: 1\nevent: update\ndata: {"progress":50}\n\ndata: {"progress":100}\n\n',view:"inspect",inputMode:"auto",format:"auto"}},
    {label:"Compare JSON responses",values:{view:"compare",inputMode:"auto",format:"auto",baseline:'HTTP/2 200\nContent-Type: application/json\n\n{"id":1,"name":"Ada"}',raw:'HTTP/2 200\nContent-Type: application/json\n\n{"id":1,"name":"Grace","active":true}'}},
    {label:"HAR response",values:{raw:JSON.stringify({log:{version:"1.2",entries:[{time:42,request:{method:"GET",url:"https://api.example.com/users"},response:{status:200,statusText:"OK",httpVersion:"HTTP/2",headers:[{name:"Content-Type",value:"application/json"}],content:{mimeType:"application/json",text:'[{"id":1}]'}}}]}}),inputMode:"har",harIndex:0,format:"auto",view:"inspect"}}
  ],
  actions:[{id:"load-file",label:"Load response / HAR file"},{id:"save-preset",label:"Save redacted preset"},{id:"clear-presets",label:"Clear saved presets"}],
  dynamicExamples(context) {return context.storage?.get<ToolExample[]>(storageKey,[]) ?? [];},
  async run(values,context,action) {
    if (action === "clear-presets") {
      if (!context.storage) throw new ToolInputError("Preset storage is unavailable.");
      await context.storage.set(storageKey,[]); return {messages:[{kind:"success",text:"Saved response presets cleared."}]};
    }
    let input = {...values};
    if (action === "load-file") {
      if (!context.files) throw new ToolInputError("File selection is unavailable. Paste the response or use the editor.");
      const file = await context.files.pick({title:"Load API response or HAR (up to 2 MiB)",filters:{"Responses":["http","txt","json","har","ndjson","jsonl","log"]},maxBytes:API_MAX_INPUT});
      if (!file) return {messages:[{kind:"info",text:"File selection cancelled."}]};
      let text: string;
      try {text = new TextDecoder("utf-8",{fatal:true}).decode(file.bytes);} catch {throw new ToolInputError("Use a UTF-8 text response or HAR file; binary files are not supported.");}
      input = {...input,raw:text,inputMode:"auto",view:"inspect",format:"auto",harIndex:0};
    }
    const workflow = str(input,"view","inspect"), exportMode = str(input,"export","none"), preview = str(input,"bodyView","pretty"), method = str(input,"method","unknown");
    if (!["inspect","compare"].includes(workflow) || !["none","json","markdown","http","typescript","schema","tests","all"].includes(exportMode) || !["pretty","raw","compact"].includes(preview)) throw new ToolInputError("Choose supported workflow, export and preview options.");
    if (!["unknown","GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"].includes(method)) throw new ToolInputError("Choose a supported request method.");
    const now = context.now?.() ?? new Date();
    const options: ApiInspectOptions & {redact?:boolean} = {mode:str(input,"inputMode","auto") as ApiInspectOptions["mode"],format:str(input,"format","auto") as ApiInspectOptions["format"],harIndex:num(input,"harIndex",0,{min:0,max:10000,integer:true}),requestMethod:method === "unknown" ? undefined : method,maxFields:num(input,"maxFields",200,{min:1,max:1000,integer:true}),now,redact:bool(input,"redact")};
    const r = inspectApiResponse(str(input,"raw"),options), outputs: Output[] = [];
    let outputBytes = 0;
    const add = (output: Output) => {outputBytes += output.kind === "code" ? Buffer.byteLength(output.content) : 0; if (outputBytes > 8 * 1024 * 1024) throw new ToolInputError("Output exceeds 8 MiB. Choose fewer exports or a smaller response."); outputs.push(output);};
    const messages: Array<{kind:"info" | "warning" | "error" | "success";text:string}> = r.diagnostics.map(d => ({kind:d.severity === "info" ? "info" as const : d.severity === "error" ? "error" as const : "warning" as const,text:`${d.category}: ${d.message}`}));
    const search = str(input,"search").trim().toLowerCase();
    if (search.length > 200) throw new ToolInputError("Search must be at most 200 characters.");
    if (workflow === "compare") {
      const baseline = inspectApiResponse(str(input,"baseline"),options);
      const ignored = str(input,"ignoreHeaders","Date, Age, Server-Timing").split(",").map(v => v.trim()).filter(Boolean);
      const diff = compareApiResponses(baseline,r,ignored);
      add(table("Changes · baseline → response",["Change","Path","Before","After"],diff.changes.map(d => [d.kind,d.path,d.before,d.after])));
      messages.unshift({kind:diff.changes.length || diff.truncated ? "info" : "success",text:diff.changes.length ? `${diff.changes.length} differences${diff.truncated ? " (comparison truncated)" : ""}. Arrays are compared by index; parsed JSON ignores object key order.` : diff.truncated ? "No differences in the inspected portion; comparison was truncated by safety limits." : "No differences found under the selected comparison rules."});
      for (const d of baseline.diagnostics.filter(d => d.severity !== "info")) messages.push({kind:d.severity === "error" ? "error" : "warning",text:`Baseline · ${d.category}: ${d.message}`});
    }
    const body = r.isJson && preview !== "raw" ? formatApiJson(r.bodyText.replace(/^\uFEFF/,""),preview === "compact") : r.bodyText;
    const language = r.isJson ? "json" : r.format === "xml" ? "xml" : r.format === "html" ? "html" : "text";
    add(code(`Body · ${r.format}`,language,body,r.isJson ? "response.json" : "response-body.txt"));
    const pointer = str(input,"pointer");
    if (pointer) {if (!r.structured) throw new ToolInputError("JSON Pointer needs a structured response body."); add(code("Selected JSON Pointer · parsed value","json",JSON.stringify(apiJsonPointer(r.body,pointer),null,2),"selected.json"));}
    const headers = r.headers.filter(([k,v]) => !search || `${k} ${apiSecretHeader(k) ? "" : v}`.toLowerCase().includes(search));
    if (headers.length) add(table("Headers · known credentials masked",["Header","Value"],headers.map(([k,v]) => [k,apiSecretHeader(k) ? "REDACTED" : v])));
    const fields = r.fields.filter(f => !search || `${f.path} ${f.pointer} ${f.type} ${f.example}`.toLowerCase().includes(search));
    if (fields.length) add(table("Fields · sampled",["Path","JSON Pointer","Type","Example"],fields.map(f => [f.path,f.pointer,f.type,f.example])));
    if (r.chain.length > 1) add(table("Response chain",["Block","Protocol","Status","Headers"],r.chain.map((block,i) => [i + 1,block.protocol ?? "",block.status ?? "unknown",block.headers.length])));
    if (r.cache.length) add(table("Cache-Control",["Directive","Value","Meaning"],r.cache));
    if (r.rateLimits.length) add(table("Rate limits · declared values",["Header","Value"],r.rateLimits));
    if (r.links.length) add(table("Pagination / location links",["Relation","Target"],r.links.map(link => [link.relation,link.url])));
    if (r.cookies.length) add(table("Cookies · values omitted",["Name","Attributes","Findings"],r.cookies.map(cookie => [cookie.name,cookie.attributes,cookie.issues.join(" ")])));
    const has = (name: string) => exportMode === name || exportMode === "all";
    if (has("json")) add(code("Inspection report","json",apiReportJson(r),"response.inspection.json"));
    if (has("markdown")) add(code("Markdown report","markdown",apiReportMarkdown(r),"response.inspection.md"));
    if (has("http")) {add(code("Reconstructed response · decoded capture","http",normalizedApiResponse(r),"response.http")); messages.push({kind:"info",text:"Reconstructed responses omit stale Content-Length, Content-Encoding and Transfer-Encoding. They are readable captures, not exact wire replays."});}
    if (has("typescript") || has("schema")) {
      try {
        const inferred = inferApiTypes(r,str(input,"typeName","ApiResponse"),pointer);
        if (has("typescript")) add(code("TypeScript · inferred sample","typescript",inferred.typescript,"response.types.ts"));
        if (has("schema")) add(code("JSON Schema · inferred sample","json",inferred.schema,"response.schema.json"));
        messages.push({kind:"info",text:"Types/schema describe captured examples, not a verified API contract. Arrays sample at most 50 items; review required fields and formats."});
      } catch (error) {if (!(error instanceof ToolInputError) || exportMode !== "all" || outputBytes > 8 * 1024 * 1024) throw error; messages.push({kind:"warning",text:error.message});}
    }
    if (has("tests")) add(code("Response assertions · test harness helper","typescript",apiAssertions(r,str(input,"testRunner","vitest") as "vitest" | "jest"),"response.assertions.ts"));
    if (action === "save-preset") {
      if (!context.storage) throw new ToolInputError("Preset storage is unavailable.");
      const name = str(input,"presetName").trim(); if (name.length > 80) throw new ToolInputError("Preset names must be at most 80 characters.");
      const safe = inspectApiResponse(str(input,"raw"),{...options,redact:true});
      const safeBaseline = workflow === "compare" ? inspectApiResponse(str(input,"baseline"),{...options,redact:true}) : undefined;
      const label = `Saved: ${name || `${safe.status ?? "Body"} ${safe.format}`}`;
      const saved = context.storage.get<ToolExample[]>(storageKey,[]).filter(p => p.label !== label);
      const preset: Values = {...input,raw:normalizedApiResponse(safe),baseline:safeBaseline ? normalizedApiResponse(safeBaseline) : "",inputMode:"auto",harIndex:0};
      await context.storage.set(storageKey,[...saved,{label,values:preset}].slice(-20));
      messages.unshift({kind:"success",text:"Saved a redacted response preset (up to 20). Review custom secrets and personal data before sharing."});
    }
    return {stats:[...(r.status ? [{label:"Status",value:String(r.status),tone:r.status >= 400 ? "bad" as const : r.status >= 300 ? "warn" as const : "good" as const}] : []),{label:"Body",value:`${r.format} · ${fmtBytes(r.bytes)}`},{label:"Headers",value:String(r.headers.length)},{label:"Findings",value:String(r.diagnostics.length)},...(r.durationMs !== undefined ? [{label:"HAR duration",value:`${r.durationMs} ms`}] : [])],messages,outputs,...(action === "load-file" ? {setValues:{raw:input.raw,inputMode:"auto",view:"inspect",format:"auto",harIndex:0}} : {})};
  }
};
