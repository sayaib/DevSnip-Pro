"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DATA_TOOLS = exports.DATA_SECTION = void 0;
const yaml_1 = __importDefault(require("yaml"));
const types_1 = require("../types");
const data_convert_1 = require("../engines/data-convert");
const data_types_1 = require("../engines/data-types");
const sql_1 = require("../engines/sql");
const data_inspect_1 = require("../engines/data-inspect");
const bigdata_1 = require("../engines/bigdata");
const llm_output_1 = require("../engines/llm-output");
const json_tools_1 = require("../../services/json-tools");
const helpers_1 = require("./helpers");
exports.DATA_SECTION = {
    id: "data",
    title: "Data",
    icon: "database",
    description: "Convert, type, query, generate, validate and profile data - from a JSON payload to a Spark cluster.",
    categories: ["Convert & model", "SQL", "Validate & inspect", "Big data"]
};
const DIALECTS = (0, helpers_1.opts)(["postgres", "PostgreSQL"], ["mysql", "MySQL / MariaDB"], ["sqlite", "SQLite"], ["sqlserver", "SQL Server"], ["spark", "Spark SQL / Databricks"]);
function parseJson(text, label) {
    if (!text.trim())
        throw new types_1.ToolInputError(`Paste ${label}.`);
    try {
        return JSON.parse(text);
    }
    catch (error) {
        const e = (0, llm_output_1.describeJsonError)(text, error);
        throw new types_1.ToolInputError(`${label} is not valid JSON: ${e.message} (line ${e.line}, column ${e.column}).`);
    }
}
/** Reads CSV/TSV, a JSON array or object, JSON Lines or YAML into rows. */
function readRows(text, format, header = true, inferTypes = true) {
    const t = text.trim();
    if (!t)
        throw new types_1.ToolInputError("Paste some data first.");
    const detected = format !== "auto" ? format
        : /^[[{]/.test(t) ? (/}\s*\r?\n\s*{/.test(t) && !t.startsWith("[") ? "jsonl" : "json")
            : /^(---|[\w"'-]+\s*:\s|-\s)/m.test(t.split(/\r?\n/)[0]) && !/[,;\t|]/.test(t.split(/\r?\n/)[0]) ? "yaml" : "csv";
    if (detected === "csv" || detected === "tsv")
        return { rows: (0, data_convert_1.csvToRows)(t, { header, inferTypes, delimiter: detected === "tsv" ? "\t" : undefined }).rows, format: detected };
    if (detected === "yaml") {
        let value;
        try {
            value = yaml_1.default.parse(t);
        }
        catch (e) {
            throw new types_1.ToolInputError(`Invalid YAML: ${e.message.split("\n")[0]}`);
        }
        const list = Array.isArray(value) ? value : [value];
        return { rows: list.map(v => (v && typeof v === "object" && !Array.isArray(v) ? v : { value: v })), format: "yaml" };
    }
    if (detected === "json")
        parseJson(t, "The JSON");
    return { rows: (0, data_convert_1.parseRecords)(t), format: detected };
}
// ---------------------------------------------------------------------------
// Convert & model
// ---------------------------------------------------------------------------
const convert = {
    id: "data.convert",
    command: "dataConverter",
    section: "data",
    category: "Convert & model",
    title: "Data Converter",
    summary: "Convert between CSV/TSV, JSON, JSON Lines, YAML, Markdown tables and SQL INSERT statements.",
    guide: "The input format is detected automatically. Nested objects are flattened to dotted columns when writing CSV or tables (address.city), and CSV numbers and booleans are typed when writing JSON.",
    keywords: ["csv to json", "json to csv", "yaml", "jsonl", "markdown table", "tsv", "sql insert", "excel"],
    icon: "table",
    live: true,
    fields: [
        helpers_1.f.code("input", "Input", "text", { rows: 10, required: true, fromEditor: true, default: "id,name,email,active,score\n1,Ada Lovelace,ada@example.com,true,98.5\n2,Alan Turing,alan@example.com,false,91\n3,\"Hopper, Grace\",grace@example.com,true," }),
        helpers_1.f.select("from", "From", (0, helpers_1.opts)(["auto", "Auto-detect"], ["csv", "CSV"], ["tsv", "TSV"], ["json", "JSON"], ["jsonl", "JSON Lines"], ["yaml", "YAML"])),
        helpers_1.f.select("to", "To", (0, helpers_1.opts)(["json", "JSON"], ["jsonl", "JSON Lines"], ["csv", "CSV"], ["tsv", "TSV"], ["yaml", "YAML"], ["markdown", "Markdown table"], ["sql", "SQL INSERT"])),
        helpers_1.f.toggle("header", "First CSV row is a header", true, { showIf: { field: "from", equals: ["auto", "csv", "tsv"] } }),
        helpers_1.f.toggle("inferTypes", "Detect numbers and booleans", true, { showIf: { field: "from", equals: ["auto", "csv", "tsv"] } }),
        helpers_1.f.text("table", "Table name", { width: "narrow", default: "my_table", showIf: { field: "to", equals: ["sql"] } }),
        helpers_1.f.select("dialect", "SQL dialect", DIALECTS, { showIf: { field: "to", equals: ["sql"] } }),
        helpers_1.f.toggle("createTable", "Include CREATE TABLE", true, { showIf: { field: "to", equals: ["sql"] } })
    ],
    run(values) {
        const { rows, format } = readRows((0, types_1.str)(values, "input"), (0, types_1.str)(values, "from", "auto"), (0, types_1.bool)(values, "header", true), (0, types_1.bool)(values, "inferTypes", true));
        const to = (0, types_1.str)(values, "to", "json");
        const flat = () => rows.map(r => (0, data_convert_1.flatten)(r));
        let output;
        let language = to;
        switch (to) {
            case "json":
                output = JSON.stringify(rows, null, 2);
                break;
            case "jsonl":
                output = rows.map(r => JSON.stringify(r)).join("\n");
                language = "jsonl";
                break;
            case "csv":
                output = (0, data_convert_1.rowsToCsv)(flat());
                language = "csv";
                break;
            case "tsv":
                output = (0, data_convert_1.rowsToCsv)(flat(), "\t");
                language = "tsv";
                break;
            case "yaml":
                output = yaml_1.default.stringify(rows, { lineWidth: 0, aliasDuplicateObjects: false });
                break;
            case "markdown":
                output = (0, data_convert_1.markdownTable)(flat());
                break;
            default:
                output = (0, sql_1.sqlFromRows)(flat(), (0, types_1.str)(values, "table", "my_table"), (0, types_1.str)(values, "dialect", "postgres"), { createTable: (0, types_1.bool)(values, "createTable", true), inserts: true, batchSize: 500 });
                language = "sql";
        }
        const ext = { json: "json", jsonl: "jsonl", csv: "csv", tsv: "tsv", yaml: "yaml", markdown: "md", sql: "sql" };
        return {
            stats: [{ label: "Read as", value: format.toUpperCase() }, { label: "Rows", value: (0, types_1.fmtNumber)(rows.length) }, { label: "Columns", value: String((0, data_convert_1.collectColumns)(to === "json" || to === "jsonl" || to === "yaml" ? rows : flat()).length) }],
            outputs: [(0, helpers_1.code)("Output", language, output, `data.${ext[to]}`)]
        };
    }
};
const types = {
    id: "data.types",
    command: "jsonToTypes",
    section: "data",
    category: "Convert & model",
    title: "JSON to Types",
    summary: "Generate TypeScript interfaces or Zod schemas, Pydantic models, dataclasses, Java records, Go structs or a JSON Schema from sample JSON.",
    guide: "Paste one example object or an array of examples: fields missing from some examples become optional, and mixed types become unions. Formats such as email, UUID and date-time are recognised.",
    keywords: ["json to typescript", "interface", "zod", "pydantic", "dataclass", "java record", "pojo", "go struct", "json schema", "quicktype"],
    icon: "braces",
    live: true,
    fields: [
        helpers_1.f.code("json", "Sample JSON", "json", { rows: 12, required: true, fromEditor: true, default: '{\n  "id": 42,\n  "email": "ada@example.com",\n  "name": "Ada",\n  "createdAt": "2025-01-15T09:30:00Z",\n  "roles": ["admin", "editor"],\n  "address": { "city": "London", "postcode": "NW1" },\n  "lastLogin": null\n}' }),
        helpers_1.f.select("target", "Generate", (0, helpers_1.opts)(["ts-interface", "TypeScript interfaces"], ["ts-type", "TypeScript types"], ["zod", "Zod schema"], ["pydantic", "Python: Pydantic"], ["dataclass", "Python: dataclasses"], ["typeddict", "Python: TypedDict"], ["java-record", "Java records"], ["java-pojo", "Java classes (POJO)"], ["go", "Go structs"], ["json-schema", "JSON Schema"])),
        helpers_1.f.text("rootName", "Root type name", { width: "narrow", default: "User" }),
        helpers_1.f.text("packageName", "Java package", { width: "narrow", default: "com.example.model", showIf: { field: "target", equals: ["java-record", "java-pojo"] } })
    ],
    run(values) {
        const root = (0, data_types_1.recordShape)(parseJson((0, types_1.str)(values, "json"), "The sample"));
        const name = (0, types_1.str)(values, "rootName").trim() || "Root";
        const target = (0, types_1.str)(values, "target", "ts-interface");
        const [language, ext, content] = target === "ts-interface" ? ["typescript", "ts", (0, data_types_1.toTypeScript)(root, name, "interface")]
            : target === "ts-type" ? ["typescript", "ts", (0, data_types_1.toTypeScript)(root, name, "type")]
                : target === "zod" ? ["typescript", "ts", (0, data_types_1.toTypeScript)(root, name, "zod")]
                    : target === "pydantic" || target === "dataclass" || target === "typeddict" ? ["python", "py", (0, data_types_1.toPython)(root, name, target)]
                        : target === "java-record" || target === "java-pojo" ? ["java", "java", (0, data_types_1.toJava)(root, name, target === "java-record" ? "record" : "pojo", (0, types_1.str)(values, "packageName", "com.example.model"))]
                            : target === "go" ? ["go", "go", (0, data_types_1.toGo)(root, name)]
                                : ["json", "json", JSON.stringify((0, data_types_1.toJsonSchema)(root, name), null, 2)];
        const fileName = ext === "java" ? `${name}.java` : ext === "go" ? "models.go" : ext === "py" ? "models.py" : ext === "json" ? `${name.toLowerCase()}.schema.json` : `${name.charAt(0).toLowerCase()}${name.slice(1)}.ts`;
        return { outputs: [(0, helpers_1.code)("Generated", language, content, fileName)] };
    }
};
const schemaValidator = {
    id: "data.schema-validate",
    command: "jsonSchemaValidator",
    section: "data",
    category: "Validate & inspect",
    title: "JSON Schema Validator",
    summary: "Validate JSON against a JSON Schema and see every violation with its path - or infer a schema from the JSON when you have none.",
    keywords: ["json schema", "validate", "ajv", "contract", "api payload", "infer schema"],
    icon: "checklist",
    live: true,
    fields: [
        helpers_1.f.code("json", "JSON", "json", { rows: 9, required: true, fromEditor: true, default: '{ "id": "42", "email": "not-an-email", "tags": [] }' }),
        helpers_1.f.code("schema", "JSON Schema (leave empty to infer one)", "json", { rows: 9, default: '{\n  "type": "object",\n  "required": ["id", "email", "name"],\n  "properties": {\n    "id": { "type": "integer" },\n    "email": { "type": "string", "pattern": "^[^@]+@[^@]+$" },\n    "name": { "type": "string", "minLength": 1 },\n    "tags": { "type": "array", "minItems": 1 }\n  }\n}' })
    ],
    run(values) {
        const value = parseJson((0, types_1.str)(values, "json"), "The JSON");
        const schemaText = (0, types_1.str)(values, "schema").trim();
        if (!schemaText) {
            return { messages: [{ kind: "info", text: "No schema given: here is one inferred from the JSON. Tighten it (required fields, formats, enums) before relying on it." }], outputs: [(0, helpers_1.code)("Inferred schema", "json", JSON.stringify((0, data_types_1.toJsonSchema)((0, data_types_1.recordShape)(value), "Document"), null, 2), "schema.json")] };
        }
        const violations = (0, json_tools_1.validateSchema)(value, parseJson(schemaText, "The schema"));
        return {
            stats: [{ label: "Result", value: violations.length ? `${violations.length} violation(s)` : "valid", tone: violations.length ? "bad" : "good" }],
            messages: violations.length ? violations.map(v => ({ kind: "error", text: `${v.path}: ${v.message}` })) : [{ kind: "success", text: "The JSON matches the schema." }]
        };
    }
};
const mock = {
    id: "data.mock",
    command: "mockDataGenerator",
    section: "data",
    category: "Convert & model",
    title: "Mock Data Generator",
    summary: "Realistic fake records from a field list or an example object, as JSON, JSON Lines, CSV or SQL inserts. Same seed, same data.",
    guide: `One field per line as name: type or name: type(args). Types: ${data_inspect_1.MOCK_TYPES.map(t => t.type).join(", ")}. Example: age: int(18, 90), plan: enum(free|pro|team). Or paste an example JSON object and the types are guessed from names and values.`,
    keywords: ["fake data", "faker", "seed data", "test data", "fixtures", "sample data"],
    icon: "sparkles",
    live: true,
    fields: [
        helpers_1.f.area("spec", "Fields or example JSON", { rows: 8, required: true, default: "id: id\nname: name\nemail: email\ncompany: company\nplan: enum(free|pro|team)\nseats: int(1, 50)\nmrr: price(0, 900)\nactive: bool\ncreated_at: datetime" }),
        helpers_1.f.num("count", "Records", 20, { min: 1, max: 10000 }),
        helpers_1.f.num("seed", "Seed", 42, { min: 0 }),
        helpers_1.f.select("format", "Output", (0, helpers_1.opts)(["json", "JSON"], ["jsonl", "JSON Lines"], ["csv", "CSV"], ["sql", "SQL INSERT"])),
        helpers_1.f.text("table", "Table name", { width: "narrow", default: "customers", showIf: { field: "format", equals: ["sql"] } }),
        helpers_1.f.select("dialect", "SQL dialect", DIALECTS, { showIf: { field: "format", equals: ["sql"] } })
    ],
    run(values) {
        let spec = (0, types_1.str)(values, "spec").trim();
        const messages = [];
        if (spec.startsWith("{")) {
            const example = parseJson(spec, "The example");
            spec = (0, data_inspect_1.mockSpecFromExample)(example);
            messages.push({ kind: "info", text: "Field types were guessed from the example; the spec is shown below so you can adjust it." });
        }
        const rows = (0, data_inspect_1.generateMock)((0, data_inspect_1.parseMockSpec)(spec), (0, types_1.num)(values, "count", 20, { min: 1, max: 10000, integer: true, label: "Records" }), (0, types_1.num)(values, "seed", 42, { min: 0, integer: true, label: "Seed" }));
        const format = (0, types_1.str)(values, "format", "json");
        const [language, content, file] = format === "jsonl" ? ["jsonl", rows.map(r => JSON.stringify(r)).join("\n"), "mock.jsonl"]
            : format === "csv" ? ["csv", (0, data_convert_1.rowsToCsv)(rows), "mock.csv"]
                : format === "sql" ? ["sql", (0, sql_1.sqlFromRows)(rows, (0, types_1.str)(values, "table", "customers"), (0, types_1.str)(values, "dialect", "postgres"), { createTable: true, inserts: true, batchSize: 500 }), "mock.sql"]
                    : ["json", JSON.stringify(rows, null, 2), "mock.json"];
        return {
            stats: [{ label: "Records", value: (0, types_1.fmtNumber)(rows.length) }],
            messages,
            outputs: [(0, helpers_1.code)("Mock data", language, content, file), ...(messages.length ? [(0, helpers_1.code)("Field spec", "text", spec)] : [])]
        };
    }
};
const transform = {
    id: "data.transform",
    command: "dataTransform",
    section: "data",
    category: "Convert & model",
    title: "Data Transformer",
    summary: "Filter, pick, rename, sort, deduplicate and flatten records from JSON, JSON Lines or CSV - a quick jq-like pipeline without the syntax.",
    guide: "Filter: field op value, joined with and / or. Operators: = != > >= < <= contains startswith endswith exists. Example: status = \"active\" and seats >= 10. Nested fields use dots: address.city = London.",
    keywords: ["filter", "jq", "select", "sort", "dedupe", "rename", "pick fields", "flatten"],
    icon: "filter",
    live: true,
    fields: [
        helpers_1.f.code("input", "Records", "json", { rows: 9, required: true, fromEditor: true, default: '[\n  {"id": 1, "name": "Ada", "team": {"name": "Core"}, "status": "active", "seats": 12},\n  {"id": 2, "name": "Linus", "team": {"name": "Kernel"}, "status": "trial", "seats": 3},\n  {"id": 3, "name": "Grace", "team": {"name": "Core"}, "status": "active", "seats": 30},\n  {"id": 3, "name": "Grace", "team": {"name": "Core"}, "status": "active", "seats": 30}\n]' }),
        helpers_1.f.text("filter", "Filter", { placeholder: 'status = "active" and seats >= 10' }),
        helpers_1.f.text("pick", "Keep fields", { width: "narrow", placeholder: "id, name, team.name" }),
        helpers_1.f.text("omit", "Drop fields", { width: "narrow", placeholder: "internal_notes" }),
        helpers_1.f.text("rename", "Rename", { width: "narrow", placeholder: "team.name: team" }),
        helpers_1.f.text("sortBy", "Sort by", { width: "narrow", placeholder: "seats desc, name" }),
        helpers_1.f.text("dedupeBy", "Deduplicate by", { width: "narrow", placeholder: "id" }),
        helpers_1.f.num("limit", "Limit", 0, { min: 0, help: "0 = no limit" }),
        helpers_1.f.toggle("flatten", "Flatten nested objects", false),
        helpers_1.f.select("output", "Output", (0, helpers_1.opts)(["json", "JSON"], ["jsonl", "JSON Lines"], ["csv", "CSV"], ["markdown", "Markdown table"]))
    ],
    run(values) {
        const { rows } = readRows((0, types_1.str)(values, "input"), "auto");
        const limit = (0, types_1.num)(values, "limit", 0, { min: 0, integer: true, label: "Limit" });
        const r = (0, data_convert_1.transformRows)(rows, { filter: (0, types_1.str)(values, "filter"), pick: (0, types_1.str)(values, "pick"), omit: (0, types_1.str)(values, "omit"), rename: (0, types_1.str)(values, "rename"), sortBy: (0, types_1.str)(values, "sortBy"), dedupeBy: (0, types_1.str)(values, "dedupeBy"), limit: limit || undefined, flatten: (0, types_1.bool)(values, "flatten") });
        const out = (0, types_1.str)(values, "output", "json");
        const content = out === "csv" ? (0, data_convert_1.rowsToCsv)(r.rows.map(x => (0, data_convert_1.flatten)(x))) : out === "markdown" ? (r.rows.length ? (0, data_convert_1.markdownTable)(r.rows.map(x => (0, data_convert_1.flatten)(x))) : "") : out === "jsonl" ? r.rows.map(x => JSON.stringify(x)).join("\n") : JSON.stringify(r.rows, null, 2);
        return {
            stats: [{ label: "Input", value: (0, types_1.fmtNumber)(rows.length) }, { label: "Output", value: (0, types_1.fmtNumber)(r.rows.length) }],
            messages: [{ kind: "info", text: r.log.join(" → ") }],
            outputs: [(0, helpers_1.code)("Result", out === "markdown" ? "markdown" : out, content)]
        };
    }
};
// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
const sqlFormatter = {
    id: "data.sql",
    command: "sparkSqlFormatter",
    section: "data",
    category: "SQL",
    title: "SQL Formatter & Linter",
    summary: "Format SQL for Postgres, MySQL, SQL Server, Spark and Trino, and flag risky patterns: SELECT *, UPDATE without WHERE, NOT IN with NULLs, implicit joins and more.",
    keywords: ["sql", "format", "beautify", "prettify", "lint", "spark sql", "presto", "trino", "query"],
    icon: "database",
    live: true,
    fields: [
        helpers_1.f.code("sql", "SQL", "sql", { rows: 12, required: true, fromEditor: true, default: "select u.id, count(o.id) as orders, coalesce(sum(o.total),0) revenue from users u left join orders o on o.user_id=u.id where u.created_at >= '2025-01-01' and u.id not in (select user_id from banned) group by u.id having count(o.id)>5 order by revenue desc limit 50;\nupdate users set active = false;" }),
        helpers_1.f.select("keywordCase", "Keywords", (0, helpers_1.opts)(["upper", "UPPERCASE"], ["lower", "lowercase"], ["preserve", "Keep as written"])),
        helpers_1.f.select("indent", "Indent", (0, helpers_1.opts)(["2", "2 spaces"], ["4", "4 spaces"], ["tab", "Tab"]))
    ],
    run(values) {
        const sql = (0, types_1.str)(values, "sql");
        if (!sql.trim())
            throw new types_1.ToolInputError("Paste a SQL query.");
        const indent = (0, types_1.str)(values, "indent", "2");
        const formatted = (0, sql_1.formatSql)(sql, { keywordCase: (0, types_1.str)(values, "keywordCase", "upper"), indent: indent === "tab" ? "\t" : " ".repeat(Number(indent)) });
        const lint = (0, sql_1.lintSql)(sql);
        return {
            stats: [{ label: "Statements", value: String(lint.statements) }, { label: "Findings", value: String(lint.findings.length), tone: lint.findings.some(x => x.severity === "error") ? "bad" : lint.findings.length ? "warn" : "good" }],
            messages: (0, helpers_1.severityMessages)(lint.findings, "No problems found."),
            outputs: [(0, helpers_1.code)("Formatted", "sql", formatted)]
        };
    }
};
const sqlHelper = {
    id: "data.sql-helper",
    command: "sqlQueryHelper",
    section: "data",
    category: "SQL",
    title: "SQL Query Helper",
    summary: "Parameterised SELECT, INSERT, UPDATE, UPSERT, DELETE and pagination queries for a table, in your database's dialect and placeholder style.",
    guide: "Paste a CREATE TABLE statement, or type the table and columns. Queries use driver placeholders ($1, ?, @p1, :name) - never concatenate user input into SQL.",
    keywords: ["crud", "upsert", "merge", "on conflict", "pagination", "keyset", "prepared statement", "insert", "update"],
    icon: "code",
    live: true,
    fields: [
        helpers_1.f.code("create", "CREATE TABLE (optional)", "sql", { rows: 6, placeholder: "CREATE TABLE users (id BIGINT PRIMARY KEY, email TEXT NOT NULL, name TEXT)" }),
        helpers_1.f.text("table", "Table", { width: "narrow", default: "users" }),
        helpers_1.f.text("columns", "Columns", { default: "id, email, name, updated_at" }),
        helpers_1.f.text("key", "Key column", { width: "narrow", default: "id" }),
        helpers_1.f.select("dialect", "Dialect", DIALECTS),
        helpers_1.f.select("paramStyle", "Placeholders", (0, helpers_1.opts)(["positional", "Positional ($1 / ? / @p1)"], ["named", "Named (:name / @name)"]))
    ],
    run(values) {
        let table = (0, types_1.str)(values, "table").trim();
        let columns = (0, types_1.str)(values, "columns").split(",").map(s => s.trim()).filter(Boolean);
        let key = (0, types_1.str)(values, "key").trim();
        const messages = [];
        const create = (0, types_1.str)(values, "create").trim();
        if (create) {
            const parsed = (0, sql_1.columnsFromCreateTable)(create);
            if (!parsed)
                throw new types_1.ToolInputError("Could not read the CREATE TABLE statement.");
            table = parsed.table;
            columns = parsed.columns;
            key = parsed.key ?? key ?? columns[0];
            messages.push({ kind: "info", text: `Read ${columns.length} columns from ${table}${parsed.key ? `, key ${parsed.key}` : ""}.` });
        }
        const queries = (0, sql_1.queryHelper)({ table, columns, key, dialect: (0, types_1.str)(values, "dialect", "postgres"), paramStyle: (0, types_1.str)(values, "paramStyle", "positional") });
        return { messages, outputs: queries.map(q => (0, helpers_1.code)(q.title, "sql", q.sql)) };
    }
};
// ---------------------------------------------------------------------------
// Validate & inspect
// ---------------------------------------------------------------------------
const apiResponse = {
    id: "data.api-response",
    command: "apiResponseInspector",
    section: "data",
    category: "Validate & inspect",
    title: "API Response Inspector",
    summary: "Paste a raw HTTP response (or just the body): pretty-printed body, headers, status meaning, pagination, caching and error hints, and a field list.",
    keywords: ["http response", "headers", "status code", "rest", "curl -i", "pagination", "cache-control"],
    icon: "api",
    live: true,
    fields: [helpers_1.f.code("raw", "Response", "http", { rows: 12, required: true, fromEditor: true, default: 'HTTP/1.1 429 Too Many Requests\nContent-Type: application/json\nRetry-After: 30\nX-RateLimit-Remaining: 0\n\n{"error": {"code": "rate_limited", "message": "Slow down"}, "requestId": "req_123"}' })],
    run(values) {
        const r = (0, data_inspect_1.inspectApiResponse)((0, types_1.str)(values, "raw"));
        return {
            stats: [
                ...(r.status ? [{ label: "Status", value: `${r.status}${r.statusText ? " " + r.statusText : ""}`, tone: (r.status < 300 ? "good" : r.status < 400 ? "neutral" : "bad") }] : []),
                { label: "Body", value: `${r.isJson ? "JSON" : "text"} · ${(0, types_1.fmtBytes)(r.bytes)}` },
                { label: "Headers", value: String(r.headers.length) }
            ],
            messages: r.insights.map(t => ({ kind: "info", text: t })),
            outputs: [
                (0, helpers_1.code)("Body", r.isJson ? "json" : "text", r.isJson ? JSON.stringify(r.body, null, 2) : r.bodyText),
                ...(r.headers.length ? [(0, helpers_1.table)("Headers", ["Header", "Value"], r.headers)] : []),
                ...(r.fields.length ? [(0, helpers_1.table)("Fields", ["Path", "Type", "Example"], r.fields.map(x => [x.path, x.type, x.example]))] : [])
            ]
        };
    }
};
const profiler = {
    id: "data.profile",
    command: "dataQualityChecker",
    section: "data",
    category: "Validate & inspect",
    title: "Data Profiler & Quality Check",
    summary: "Profile CSV, JSON or JSON Lines: type, missing values, distinct counts, ranges and outliers per column, plus duplicate rows and quality warnings.",
    keywords: ["profile", "data quality", "missing values", "nulls", "duplicates", "outliers", "eda", "csv"],
    icon: "sliders",
    live: true,
    fields: [
        helpers_1.f.code("input", "Data", "text", { rows: 10, required: true, fromEditor: true, default: "id,name,age,country,signup\n1,Ada,36,UK,2025-01-02\n2,Alan,41,UK,2025-01-05\n3,Grace,,US,2025-02-11\n4,Linus,29,FI,not a date\n5,Ada,36,UK,2025-01-02\n6,Margaret,420,US,2025-03-01" }),
        helpers_1.f.select("from", "Format", (0, helpers_1.opts)(["auto", "Auto-detect"], ["csv", "CSV"], ["tsv", "TSV"], ["json", "JSON"], ["jsonl", "JSON Lines"]))
    ],
    run(values) {
        const { rows } = readRows((0, types_1.str)(values, "input"), (0, types_1.str)(values, "from", "auto"));
        const p = (0, data_inspect_1.profileRows)(rows);
        const cols = p.columns;
        return {
            stats: [
                { label: "Rows", value: (0, types_1.fmtNumber)(rows.length) },
                { label: "Columns", value: String(cols.length) },
                { label: "Missing cells", value: (0, types_1.fmtNumber)(cols.reduce((s, c) => s + c.missing, 0)), tone: cols.some(c => c.missing) ? "warn" : "good" },
                { label: "Duplicate rows", value: String(p.duplicateRows), tone: p.duplicateRows ? "warn" : "good" }
            ],
            messages: p.notes.length ? p.notes.map(t => ({ kind: "warning", text: t })) : [{ kind: "success", text: "No quality issues found in this sample." }],
            outputs: [(0, helpers_1.table)("Columns", ["Column", "Type", "Missing", "Distinct", "Min", "Max", "Mean", "Outliers", "Most common"], cols.map(c => [c.name, c.type, c.missing ? `${c.missing} (${((c.missing / rows.length) * 100).toFixed(0)}%)` : "0", c.distinct, c.min ?? "", c.max ?? "", c.mean !== undefined ? Number(c.mean.toFixed(3)) : "", c.outliers ?? "", c.top]))]
        };
    }
};
const jsonl = {
    id: "data.jsonl",
    command: "jsonlViewer",
    section: "data",
    category: "Validate & inspect",
    title: "JSON Lines Inspector",
    summary: "Validate a JSONL file line by line (fine-tuning data, logs, exports), see its fields and preview records as a table.",
    keywords: ["jsonl", "ndjson", "json lines", "fine-tuning", "training data", "validate"],
    icon: "table",
    live: true,
    fields: [
        helpers_1.f.code("input", "JSON Lines", "jsonl", { rows: 10, required: true, fromEditor: true, default: '{"messages": [{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello!"}]}\n{"messages": [{"role": "user", "content": "2+2?"}, {"role": "assistant", "content": "4"}]}\n{"messages": [{"role": "user", "content": "broken"}' }),
        helpers_1.f.num("preview", "Rows to preview", 50, { min: 1, max: 500 })
    ],
    run(values) {
        const text = (0, types_1.str)(values, "input");
        if (!text.trim())
            throw new types_1.ToolInputError("Paste JSON Lines.");
        const { rows, errors } = (0, data_convert_1.parseJsonl)(text);
        const objects = rows.map(r => (r && typeof r === "object" && !Array.isArray(r) ? (0, data_convert_1.flatten)(r) : { value: r }));
        const fieldCounts = new Map();
        for (const o of objects)
            for (const k of Object.keys(o))
                fieldCounts.set(k, (fieldCounts.get(k) ?? 0) + 1);
        const preview = objects.slice(0, (0, types_1.num)(values, "preview", 50, { min: 1, max: 500, integer: true, label: "Rows to preview" }));
        const columns = (0, data_convert_1.collectColumns)(preview).slice(0, 12);
        const cell = (v) => { const s = v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return s.length > 80 ? s.slice(0, 80) + "…" : s; };
        return {
            stats: [{ label: "Valid records", value: (0, types_1.fmtNumber)(rows.length), tone: "good" }, { label: "Invalid lines", value: String(errors.length), tone: errors.length ? "bad" : "good" }, { label: "Fields", value: String(fieldCounts.size) }],
            messages: errors.slice(0, 100).map(e => ({ kind: "error", text: `Line ${e.line}: ${e.message}` })),
            outputs: [
                (0, helpers_1.table)("Fields", ["Field", "Present in", "Coverage"], [...fieldCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n, `${((n / Math.max(1, rows.length)) * 100).toFixed(0)}%`])),
                ...(columns.length ? [(0, helpers_1.table)(`Preview (first ${preview.length})`, columns, preview.map(r => columns.map(c => cell(r[c]))))] : [])
            ]
        };
    }
};
// ---------------------------------------------------------------------------
// Big data
// ---------------------------------------------------------------------------
const schemaViewer = {
    id: "data.schema",
    command: "schemaViewer",
    section: "data",
    category: "Big data",
    title: "Schema Viewer",
    summary: "Read a JSON Schema, Avro schema, Spark StructType or a sample JSON document as a field tree with types and nullability.",
    keywords: ["schema", "avro", "parquet", "spark", "structtype", "json schema", "fields"],
    icon: "tree",
    live: true,
    fields: [helpers_1.f.code("schema", "Schema or sample JSON", "json", { rows: 12, required: true, fromEditor: true, default: '{"type": "record", "name": "Order", "fields": [{"name": "id", "type": "long"}, {"name": "customer", "type": {"type": "record", "name": "Customer", "fields": [{"name": "email", "type": "string"}, {"name": "tier", "type": ["null", "string"]}]}}, {"name": "items", "type": {"type": "array", "items": "string"}}, {"name": "total", "type": "double"}]}' })],
    run(values) {
        const { format, fields } = (0, bigdata_1.normalizeSchema)((0, types_1.str)(values, "schema"));
        return {
            stats: [{ label: "Format", value: format }, { label: "Fields", value: String(fields.length) }, { label: "Nullable", value: String(fields.filter(x => x.nullable).length) }],
            outputs: [(0, helpers_1.code)("Tree", "text", (0, bigdata_1.schemaTree)(fields)), (0, helpers_1.table)("Fields", ["Path", "Type", "Nullable"], fields.map(x => [x.path, x.type, x.nullable ? "yes" : "no"]))]
        };
    }
};
const schemaDiffTool = {
    id: "data.schema-diff",
    command: "schemaDiff",
    section: "data",
    category: "Big data",
    title: "Schema Diff",
    summary: "Compare two schemas (JSON Schema, Avro, Spark or sample JSON) and flag breaking changes: removed fields, narrowed types, new required fields.",
    keywords: ["schema evolution", "breaking change", "compatibility", "avro", "migration"],
    icon: "diff",
    live: true,
    fields: [
        helpers_1.f.code("before", "Before", "json", { rows: 8, required: true, default: '{"id": 1, "email": "a@b.c", "age": 30, "plan": "pro"}' }),
        helpers_1.f.code("after", "After", "json", { rows: 8, required: true, default: '{"id": 1, "email": "a@b.c", "age": 30.5, "country": "UK"}' })
    ],
    run(values) {
        const changes = (0, bigdata_1.diffSchemas)((0, bigdata_1.normalizeSchema)((0, types_1.str)(values, "before")).fields, (0, bigdata_1.normalizeSchema)((0, types_1.str)(values, "after")).fields);
        const breaking = changes.filter(c => c.breaking);
        return {
            stats: [{ label: "Changes", value: String(changes.length) }, { label: "Breaking", value: String(breaking.length), tone: breaking.length ? "bad" : "good" }],
            messages: changes.length ? breaking.length ? [{ kind: "warning", text: "Breaking changes need a new schema version or a migration for existing readers." }] : [{ kind: "success", text: "All changes are backward compatible." }] : [{ kind: "success", text: "The schemas are identical." }],
            outputs: changes.length ? [(0, helpers_1.table)("Changes", ["Field", "Change", "Breaking"], changes.map(c => [c.path, c.change, c.breaking ? "yes" : "no"]))] : []
        };
    }
};
const partitions = {
    id: "data.partitions",
    command: "partitionCalc",
    section: "data",
    category: "Big data",
    title: "Partition & File Size Planner",
    summary: "Size table partitions and output files for Parquet/Delta, get a shuffle partition count, and PySpark code that writes well-sized files.",
    keywords: ["partition", "spark", "shuffle partitions", "small files", "parquet", "delta", "repartition"],
    icon: "grid",
    live: true,
    fields: [
        helpers_1.f.num("totalGB", "Data size (GB, uncompressed)", 500, { min: 0.001 }),
        helpers_1.f.num("compressionRatio", "Compression ratio", 4, { min: 1, max: 20 }),
        helpers_1.f.num("partitionCount", "Table partitions (distinct values)", 365, { min: 1 }),
        helpers_1.f.num("targetFileMB", "Target file size (MB)", 256, { min: 1 }),
        helpers_1.f.num("executorCores", "Total executor cores", 64, { min: 1 }),
        helpers_1.f.text("column", "Partition column", { width: "narrow", default: "event_date" })
    ],
    run(values) {
        const p = {
            totalGB: (0, types_1.num)(values, "totalGB", 500, { min: 0.001, label: "Data size" }),
            compressionRatio: (0, types_1.num)(values, "compressionRatio", 4, { min: 1, max: 20, label: "Compression ratio" }),
            partitionCount: (0, types_1.num)(values, "partitionCount", 365, { min: 1, integer: true, label: "Partitions" }),
            targetFileMB: (0, types_1.num)(values, "targetFileMB", 256, { min: 1, label: "Target file size" }),
            executorCores: (0, types_1.num)(values, "executorCores", 64, { min: 1, integer: true, label: "Cores" })
        };
        const r = (0, bigdata_1.planPartitions)(p);
        return {
            stats: [
                { label: "On disk", value: (0, types_1.fmtBytes)(r.onDiskBytes) },
                { label: "Per partition", value: (0, types_1.fmtBytes)(r.perPartitionBytes) },
                { label: "Files per partition", value: String(r.filesPerPartition) },
                { label: "Total files", value: (0, types_1.fmtNumber)(r.totalFiles) },
                { label: "spark.sql.shuffle.partitions", value: (0, types_1.fmtNumber)(r.shufflePartitions) }
            ],
            messages: r.warnings.map(w => ({ kind: "warning", text: w })),
            outputs: [(0, helpers_1.code)("PySpark", "python", (0, bigdata_1.partitionCode)(p, (0, types_1.str)(values, "column", "event_date"), r.shufflePartitions, r.filesPerPartition), "write_partitioned.py")]
        };
    }
};
const cluster = {
    id: "data.spark-cluster",
    command: "sparkCostEstimator",
    section: "data",
    category: "Big data",
    title: "Spark Cluster & Cost Estimator",
    summary: "Workers, executor layout (cores and memory per executor) and daily and monthly cost for a Spark job.",
    keywords: ["spark", "cluster", "executors", "databricks", "emr", "dataproc", "cost", "sizing"],
    icon: "cloud",
    live: true,
    fields: [
        helpers_1.f.num("dataGBPerRun", "Data per run (GB)", 200, { min: 0.1 }),
        helpers_1.f.num("memoryFactor", "Memory needed (× data size)", 1.5, { min: 0.1, max: 10, step: 0.1, help: "~1-2× for joins and aggregations; less for simple scans." }),
        helpers_1.f.num("runsPerDay", "Runs per day", 4, { min: 0 }),
        helpers_1.f.num("runtimeMinutes", "Runtime (minutes)", 45, { min: 1 }),
        helpers_1.f.num("nodeCores", "Cores per node", 16, { min: 2 }),
        helpers_1.f.num("nodeMemoryGB", "Memory per node (GB)", 64, { min: 4 }),
        helpers_1.f.num("nodeHourlyUsd", "Node price ($/hour)", 0.77, { min: 0, step: 0.01 }),
        helpers_1.f.num("platformUpliftPct", "Platform surcharge %", 0, { min: 0, max: 300, help: "e.g. Databricks DBUs or EMR fee on top of VM price." })
    ],
    run(values) {
        const c = (0, bigdata_1.sizeCluster)({
            dataGBPerRun: (0, types_1.num)(values, "dataGBPerRun", 200, { min: 0.1, label: "Data per run" }),
            memoryFactor: (0, types_1.num)(values, "memoryFactor", 1.5, { min: 0.1, max: 10, label: "Memory factor" }),
            runsPerDay: (0, types_1.num)(values, "runsPerDay", 4, { min: 0, label: "Runs per day" }),
            runtimeMinutes: (0, types_1.num)(values, "runtimeMinutes", 45, { min: 1, label: "Runtime" }),
            nodeCores: (0, types_1.num)(values, "nodeCores", 16, { min: 2, integer: true, label: "Cores per node" }),
            nodeMemoryGB: (0, types_1.num)(values, "nodeMemoryGB", 64, { min: 4, label: "Memory per node" }),
            nodeHourlyUsd: (0, types_1.num)(values, "nodeHourlyUsd", 0.77, { min: 0, label: "Node price" }),
            platformUpliftPct: (0, types_1.num)(values, "platformUpliftPct", 0, { min: 0, max: 300, label: "Surcharge" })
        });
        return {
            stats: [
                { label: "Workers (+1 driver)", value: String(c.workers) },
                { label: "Cluster $/hour", value: (0, types_1.fmtUsd)(c.hourly) },
                { label: "Per day", value: (0, types_1.fmtUsd)(c.daily) },
                { label: "Per month", value: (0, types_1.fmtUsd)(c.monthly) }
            ],
            outputs: [(0, helpers_1.code)("spark-submit settings", "shell", `--num-executors ${c.workers * c.executorsPerNode} \\\n--executor-cores ${c.coresPerExecutor} \\\n--executor-memory ${c.executorMemoryGB}g \\\n--conf spark.sql.adaptive.enabled=true \\\n--conf spark.dynamicAllocation.enabled=true`)],
            messages: [{ kind: "info", text: "One core per node is left for the OS and daemons, and executors get ~5 cores each for good HDFS/S3 throughput. Validate with the Spark UI after the first run." }]
        };
    }
};
const deltaLog = {
    id: "data.delta-log",
    command: "deltaLakeAnalyzer",
    section: "data",
    category: "Big data",
    title: "Delta Lake Log Analyzer",
    summary: "Paste _delta_log commit files to see operations, files added and removed, small-file ratio, schema changes and OPTIMIZE / VACUUM advice.",
    keywords: ["delta lake", "_delta_log", "optimize", "vacuum", "small files", "databricks", "lakehouse"],
    icon: "database",
    live: true,
    fields: [
        helpers_1.f.code("log", "Commit JSON", "jsonl", { rows: 10, required: true, fromEditor: true, default: '{"commitInfo": {"timestamp": 1727600000000, "operation": "WRITE", "engineInfo": "Apache-Spark/3.5.0 Delta-Lake/3.2.0"}}\n{"add": {"path": "part-0001.parquet", "size": 1048576, "dataChange": true}}\n{"add": {"path": "part-0002.parquet", "size": 734003, "dataChange": true}}\n{"commitInfo": {"timestamp": 1727603600000, "operation": "MERGE"}}\n{"remove": {"path": "part-0001.parquet", "size": 1048576}}\n{"add": {"path": "part-0003.parquet", "size": 268435456, "dataChange": true}}' }),
        helpers_1.f.num("smallFileMB", "Small file threshold (MB)", 32, { min: 1 })
    ],
    run(values) {
        const r = (0, bigdata_1.analyzeDeltaLog)((0, types_1.str)(values, "log"), (0, types_1.num)(values, "smallFileMB", 32, { min: 1, label: "Threshold" }));
        return {
            stats: [
                { label: "Commits", value: String(r.commits) },
                { label: "Files added / removed", value: `${r.adds} / ${r.removes}` },
                { label: "Data added", value: (0, types_1.fmtBytes)(r.addBytes) },
                { label: "Small files", value: `${r.smallFiles} of ${r.adds}`, tone: r.adds && r.smallFiles / r.adds > 0.3 ? "warn" : "good" }
            ],
            messages: [...r.recommendations.map(t => ({ kind: "warning", text: t })), ...(r.protocol ? [{ kind: "info", text: `Protocol: ${r.protocol}` }] : []), ...(r.engine ? [{ kind: "info", text: `Engine: ${r.engine}` }] : [])],
            outputs: [(0, helpers_1.table)("Operations", ["Operation", "Commits"], r.operations), ...(r.schemaChanges.length ? [(0, helpers_1.table)("Schema changes", ["Change"], r.schemaChanges.map(s => [s]))] : [])]
        };
    }
};
exports.DATA_TOOLS = [
    convert, types, mock, transform,
    sqlFormatter, sqlHelper,
    schemaValidator, apiResponse, profiler, jsonl,
    schemaViewer, schemaDiffTool, partitions, cluster, deltaLog
];
//# sourceMappingURL=data.js.map