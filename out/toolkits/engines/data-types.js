"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSwift = exports.toKotlin = exports.toDart = exports.toJsonSchema = exports.toGo = exports.toJava = exports.toPython = exports.toTypeScript = exports.snake = exports.camel = exports.pascal = exports.recordShape = exports.merge = exports.shapeOf = void 0;
const types_1 = require("../types");
function stringFormat(value) {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(value))
        return "date-time";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value))
        return "date";
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        return "email";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
        return "uuid";
    if (/^https?:\/\/\S+$/.test(value))
        return "uri";
    return "text";
}
function shapeOf(value) {
    if (value === null || value === undefined)
        return { kind: "null" };
    if (typeof value === "string")
        return { kind: "string", formats: new Set([stringFormat(value)]) };
    if (typeof value === "number")
        return Number.isInteger(value) ? { kind: "integer" } : { kind: "number" };
    if (typeof value === "boolean")
        return { kind: "boolean" };
    if (Array.isArray(value))
        return { kind: "array", item: value.length ? value.map(shapeOf).reduce(merge) : { kind: "unknown" } };
    const fields = new Map();
    for (const [key, v] of Object.entries(value))
        fields.set(key, { shape: shapeOf(v), count: 1 });
    return { kind: "object", fields, samples: 1 };
}
exports.shapeOf = shapeOf;
function merge(a, b) {
    if (a.kind === "unknown")
        return b;
    if (b.kind === "unknown")
        return a;
    if (a.kind === "union" || b.kind === "union") {
        const options = [...(a.kind === "union" ? a.options : [a])];
        for (const option of b.kind === "union" ? b.options : [b]) {
            const index = options.findIndex(o => compatible(o, option));
            if (index >= 0)
                options[index] = merge(options[index], option);
            else
                options.push(option);
        }
        return options.length === 1 ? options[0] : { kind: "union", options };
    }
    if ((a.kind === "integer" && b.kind === "number") || (a.kind === "number" && b.kind === "integer"))
        return { kind: "number" };
    if (a.kind !== b.kind)
        return { kind: "union", options: [a, b] };
    switch (a.kind) {
        case "string": return { kind: "string", formats: new Set([...a.formats, ...b.formats]) };
        case "array": return { kind: "array", item: merge(a.item, b.item) };
        case "object": {
            const other = b;
            const fields = new Map();
            for (const [key, f] of a.fields)
                fields.set(key, { ...f });
            for (const [key, f] of other.fields) {
                const existing = fields.get(key);
                fields.set(key, existing ? { shape: merge(existing.shape, f.shape), count: existing.count + f.count } : { ...f });
            }
            return { kind: "object", fields, samples: a.samples + other.samples };
        }
        default: return a;
    }
}
exports.merge = merge;
function compatible(a, b) {
    if (a.kind === b.kind)
        return true;
    return (a.kind === "integer" && b.kind === "number") || (a.kind === "number" && b.kind === "integer");
}
/** The shape of one record: for an array input, all elements merged. */
function recordShape(value) {
    if (Array.isArray(value)) {
        if (!value.length)
            throw new types_1.ToolInputError("The array is empty; add at least one example element.");
        return value.map(shapeOf).reduce(merge);
    }
    return shapeOf(value);
}
exports.recordShape = recordShape;
// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------
function pascal(name) {
    const cleaned = name.replace(/[^A-Za-z0-9]+/g, " ").trim();
    const result = cleaned.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("") || "Item";
    return /^\d/.test(result) ? `T${result}` : result;
}
exports.pascal = pascal;
function camel(name) {
    const p = pascal(name);
    return p.charAt(0).toLowerCase() + p.slice(1);
}
exports.camel = camel;
function snake(name) {
    const result = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "field";
    return /^\d/.test(result) ? `f_${result}` : result;
}
exports.snake = snake;
function singular(name) {
    if (/ies$/i.test(name))
        return name.slice(0, -3) + "y";
    if (/(ss|us)$/i.test(name))
        return name;
    if (/ses$/i.test(name))
        return name.slice(0, -2);
    if (/s$/i.test(name) && name.length > 3)
        return name.slice(0, -1);
    return `${name}Item`;
}
/** Walks the shape and assigns a unique type name to every nested object. */
function collectObjects(root, rootName) {
    const objects = [];
    const nameOf = new Map();
    const used = new Set();
    const unique = (base) => {
        let name = pascal(base);
        let n = 2;
        while (used.has(name))
            name = `${pascal(base)}${n++}`;
        used.add(name);
        return name;
    };
    const visit = (shape, hint) => {
        if (shape.kind === "object") {
            const name = unique(hint);
            nameOf.set(shape, name);
            objects.push({ name, shape });
            for (const [key, field] of shape.fields)
                visit(field.shape, key);
        }
        else if (shape.kind === "array")
            visit(shape.item, singular(hint));
        else if (shape.kind === "union")
            shape.options.forEach(o => visit(o, hint));
    };
    visit(root, rootName);
    return { objects, nameOf };
}
const optional = (shape, key) => shape.fields.get(key).count < shape.samples;
const nullable = (s) => s.kind === "null" || (s.kind === "union" && s.options.some(o => o.kind === "null"));
const validIdentifier = (key) => /^[A-Za-z_$][\w$]*$/.test(key);
// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------
function toTypeScript(root, rootName, style) {
    const { objects, nameOf } = collectObjects(root, rootName);
    if (style === "zod") {
        const zod = (s) => {
            switch (s.kind) {
                case "string": {
                    const f = [...s.formats].filter(x => x !== "text");
                    return f.length === 1 && s.formats.size === 1 ? `z.string()${f[0] === "email" ? ".email()" : f[0] === "uuid" ? ".uuid()" : f[0] === "uri" ? ".url()" : f[0] === "date-time" ? ".datetime({ offset: true })" : f[0] === "date" ? ".date()" : ""}` : "z.string()";
                }
                case "integer": return "z.number().int()";
                case "number": return "z.number()";
                case "boolean": return "z.boolean()";
                case "null": return "z.null()";
                case "unknown": return "z.unknown()";
                case "array": return `z.array(${zod(s.item)})`;
                case "object": return `${camel(nameOf.get(s))}Schema`;
                case "union": {
                    const rest = s.options.filter(o => o.kind !== "null");
                    const base = rest.length === 1 ? zod(rest[0]) : `z.union([${rest.map(zod).join(", ")}])`;
                    return nullable(s) ? `${base}.nullable()` : base;
                }
            }
        };
        const blocks = [...objects].reverse().map(({ name, shape }) => {
            const fields = [...shape.fields].map(([key, f]) => `  ${validIdentifier(key) ? key : JSON.stringify(key)}: ${zod(f.shape)}${optional(shape, key) ? ".optional()" : ""},`);
            return `export const ${camel(name)}Schema = z.object({\n${fields.join("\n")}\n});\nexport type ${name} = z.infer<typeof ${camel(name)}Schema>;`;
        });
        return `import { z } from "zod";\n\n${blocks.join("\n\n")}\n`;
    }
    const ts = (s) => {
        switch (s.kind) {
            case "string": return "string";
            case "integer":
            case "number": return "number";
            case "boolean": return "boolean";
            case "null": return "null";
            case "unknown": return "unknown";
            case "array": {
                const inner = ts(s.item);
                return /[|&]/.test(inner) ? `Array<${inner}>` : `${inner}[]`;
            }
            case "object": return nameOf.get(s);
            case "union": return s.options.map(ts).join(" | ");
        }
    };
    if (root.kind !== "object")
        return `export type ${pascal(rootName)} = ${ts(root)};\n`;
    const blocks = objects.map(({ name, shape }) => {
        const fields = [...shape.fields].map(([key, f]) => `  ${validIdentifier(key) ? key : JSON.stringify(key)}${optional(shape, key) ? "?" : ""}: ${ts(f.shape)};`);
        return style === "type" ? `export type ${name} = {\n${fields.join("\n")}\n};` : `export interface ${name} {\n${fields.join("\n")}\n}`;
    });
    return blocks.join("\n\n") + "\n";
}
exports.toTypeScript = toTypeScript;
function toPython(root, rootName, style) {
    const { objects, nameOf } = collectObjects(root, rootName);
    const imports = new Set();
    const py = (s) => {
        switch (s.kind) {
            case "string": {
                const f = s.formats.size === 1 ? [...s.formats][0] : "text";
                if (f === "date-time") {
                    imports.add("from datetime import datetime");
                    return "datetime";
                }
                if (f === "date") {
                    imports.add("from datetime import date");
                    return "date";
                }
                if (f === "uuid") {
                    imports.add("from uuid import UUID");
                    return "UUID";
                }
                return "str";
            }
            case "integer": return "int";
            case "number": return "float";
            case "boolean": return "bool";
            case "null": return "None";
            case "unknown":
                imports.add("from typing import Any");
                return "Any";
            case "array": return `list[${py(s.item)}]`;
            case "object": return nameOf.get(s);
            case "union": return s.options.map(py).join(" | ");
        }
    };
    if (root.kind !== "object")
        return `${pascal(rootName)} = ${py(root)}\n`;
    const blocks = [...objects].reverse().map(({ name, shape }) => {
        const required = [];
        const optionalFields = [];
        for (const [key, f] of shape.fields) {
            const field = snake(key);
            const isOptional = optional(shape, key);
            let type = py(f.shape);
            if (isOptional && !nullable(f.shape))
                type = `${type} | None`;
            let line;
            if (style === "pydantic") {
                const alias = field !== key ? `alias=${JSON.stringify(key)}` : "";
                if (alias)
                    imports.add("from pydantic import Field");
                line = `    ${field}: ${type}${alias ? ` = Field(${isOptional ? "default=None, " : ""}${alias})` : isOptional ? " = None" : ""}`;
            }
            else if (style === "typeddict") {
                if (isOptional)
                    imports.add("from typing import NotRequired");
                line = `    ${field}: ${isOptional ? `NotRequired[${type}]` : type}`;
            }
            else {
                line = `    ${field}: ${type}${isOptional ? " = None" : ""}`;
            }
            (isOptional && style !== "typeddict" ? optionalFields : required).push(line);
        }
        // Dataclass fields with defaults must come after those without.
        const body = [...required, ...optionalFields];
        const header = style === "pydantic" ? `class ${name}(BaseModel):` : style === "typeddict" ? `class ${name}(TypedDict):` : `@dataclass\nclass ${name}:`;
        return `${header}\n${body.join("\n") || "    pass"}`;
    });
    const head = style === "pydantic" ? "from pydantic import BaseModel" : style === "typeddict" ? "from typing import TypedDict" : "from dataclasses import dataclass";
    const allImports = ["from __future__ import annotations", "", ...[...imports].filter(i => !i.startsWith("from pydantic import Field")).sort(), head + (imports.has("from pydantic import Field") ? ", Field" : "")];
    return `${allImports.join("\n")}\n\n\n${blocks.join("\n\n\n")}\n`;
}
exports.toPython = toPython;
const JAVA_KEYWORDS = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while record var yield".split(" "));
function toJava(root, rootName, style, packageName) {
    const { objects, nameOf } = collectObjects(root, rootName);
    const imports = new Set();
    const java = (s, boxed = true) => {
        switch (s.kind) {
            case "string": {
                const f = s.formats.size === 1 ? [...s.formats][0] : "text";
                if (f === "date-time") {
                    imports.add("java.time.OffsetDateTime");
                    return "OffsetDateTime";
                }
                if (f === "date") {
                    imports.add("java.time.LocalDate");
                    return "LocalDate";
                }
                if (f === "uuid") {
                    imports.add("java.util.UUID");
                    return "UUID";
                }
                return "String";
            }
            case "integer": return boxed ? "Long" : "long";
            case "number": return boxed ? "Double" : "double";
            case "boolean": return boxed ? "Boolean" : "boolean";
            case "null":
            case "unknown": return "Object";
            case "array":
                imports.add("java.util.List");
                return `List<${java(s.item)}>`;
            case "object": return nameOf.get(s);
            case "union": {
                const rest = s.options.filter(o => o.kind !== "null");
                return rest.length === 1 ? java(rest[0]) : "Object";
            }
        }
    };
    if (root.kind !== "object")
        throw new types_1.ToolInputError("Java classes need a JSON object (or an array of objects) as input.");
    const fieldName = (key) => {
        const name = camel(key);
        return JAVA_KEYWORDS.has(name) ? `${name}Value` : name;
    };
    const types = objects.map(({ name, shape }) => {
        const fields = [...shape.fields].map(([key, f]) => ({ key, name: fieldName(key), type: java(f.shape, optional(shape, key) || nullable(f.shape)) }));
        const needsAnnotation = fields.some(f => f.name !== f.key);
        if (needsAnnotation)
            imports.add("com.fasterxml.jackson.annotation.JsonProperty");
        const ann = (f) => (f.name !== f.key ? `@JsonProperty(${JSON.stringify(f.key)}) ` : "");
        if (style === "record") {
            return `public record ${name}(\n${fields.map(f => `    ${ann(f)}${f.type} ${f.name}`).join(",\n")}\n) {}`;
        }
        const decls = fields.map(f => `    ${ann(f)}private ${f.type} ${f.name};`).join("\n");
        const accessors = fields.map(f => {
            const cap = f.name.charAt(0).toUpperCase() + f.name.slice(1);
            const getter = f.type === "boolean" ? "is" : "get";
            return `    public ${f.type} ${getter}${cap}() {\n        return ${f.name};\n    }\n\n    public void set${cap}(${f.type} ${f.name}) {\n        this.${f.name} = ${f.name};\n    }`;
        }).join("\n\n");
        return `public class ${name} {\n${decls}\n\n${accessors}\n}`;
    });
    // One public top-level type per file: nest the others as static members of the root type.
    const [first, ...rest] = types;
    const nested = rest.map(t => t.replace(/^public (record|class)/, "public static $1").split("\n").map(line => `    ${line}`).join("\n"));
    const combined = nested.length ? first.replace(/\n}$|\) \{\}$/, match => (match.startsWith(")") ? `) {\n${nested.join("\n\n")}\n}` : `\n\n${nested.join("\n\n")}\n}`)) : first;
    const pkg = packageName.trim() ? `package ${packageName.trim()};\n\n` : "";
    const importBlock = imports.size ? [...imports].sort().map(i => `import ${i};`).join("\n") + "\n\n" : "";
    return `${pkg}${importBlock}${combined}\n`;
}
exports.toJava = toJava;
function toGo(root, rootName) {
    const { objects, nameOf } = collectObjects(root, rootName);
    let needsTime = false;
    const go = (s) => {
        switch (s.kind) {
            case "string": {
                if (s.formats.size === 1 && s.formats.has("date-time")) {
                    needsTime = true;
                    return "time.Time";
                }
                return "string";
            }
            case "integer": return "int64";
            case "number": return "float64";
            case "boolean": return "bool";
            case "null":
            case "unknown": return "any";
            case "array": return `[]${go(s.item)}`;
            case "object": return nameOf.get(s);
            case "union": {
                const rest = s.options.filter(o => o.kind !== "null");
                return rest.length === 1 ? `*${go(rest[0])}` : "any";
            }
        }
    };
    if (root.kind !== "object")
        return `type ${pascal(rootName)} ${go(root)}\n`;
    const structs = objects.map(({ name, shape }) => {
        const fields = [...shape.fields].map(([key, f]) => {
            const type = go(f.shape);
            const opt = optional(shape, key);
            return `\t${pascal(key)} ${opt && !type.startsWith("*") && !type.startsWith("[]") && type !== "any" ? `*${type}` : type} \`json:"${key}${opt ? ",omitempty" : ""}"\``;
        });
        return `type ${name} struct {\n${fields.join("\n")}\n}`;
    });
    return `package models\n\n${needsTime ? `import "time"\n\n` : ""}${structs.join("\n\n")}\n`;
}
exports.toGo = toGo;
function toJsonSchema(root, title) {
    const schema = (s) => {
        switch (s.kind) {
            case "string": {
                const f = [...s.formats].filter(x => x !== "text");
                return f.length === 1 && s.formats.size === 1 ? { type: "string", format: f[0] } : { type: "string" };
            }
            case "integer": return { type: "integer" };
            case "number": return { type: "number" };
            case "boolean": return { type: "boolean" };
            case "null": return { type: "null" };
            case "unknown": return {};
            case "array": return { type: "array", items: schema(s.item) };
            case "object": {
                const properties = {};
                const required = [];
                for (const [key, f] of s.fields) {
                    properties[key] = schema(f.shape);
                    if (f.count === s.samples)
                        required.push(key);
                }
                return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false };
            }
            case "union": {
                const types = s.options.map(schema);
                const simple = types.every(t => Object.keys(t).length === 1 && typeof t.type === "string");
                return simple ? { type: types.map(t => t.type) } : { anyOf: types };
            }
        }
    };
    return { $schema: "https://json-schema.org/draft/2020-12/schema", title, ...schema(root) };
}
exports.toJsonSchema = toJsonSchema;
// ---------------------------------------------------------------------------
// Mobile: Dart (Flutter), Kotlin (Android) and Swift (iOS)
// ---------------------------------------------------------------------------
/** The non-null option of a nullable union, or the shape itself. */
function nonNull(s) {
    if (s.kind !== "union")
        return s;
    const rest = s.options.filter(o => o.kind !== "null");
    return rest.length === 1 ? rest[0] : s;
}
const isDateTime = (s) => s.kind === "string" && s.formats.size === 1 && s.formats.has("date-time");
const DART_RESERVED = new Set("abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield".split(" "));
function toDart(root, rootName, style) {
    if (root.kind !== "object")
        throw new types_1.ToolInputError("Dart classes need a JSON object (or an array of objects).");
    const { objects, nameOf } = collectObjects(root, rootName);
    const type = (s) => {
        const t = nonNull(s);
        switch (t.kind) {
            case "string": return isDateTime(t) ? "DateTime" : "String";
            case "integer": return "int";
            case "number": return "double";
            case "boolean": return "bool";
            case "array": return `List<${type(t.item)}>`;
            case "object": return nameOf.get(t);
            default: return "dynamic";
        }
    };
    const fromJson = (s, v, nullable) => {
        const t = nonNull(s);
        const q = nullable ? "?" : "";
        switch (t.kind) {
            case "string": return isDateTime(t) ? (nullable ? `${v} == null ? null : DateTime.parse(${v} as String)` : `DateTime.parse(${v} as String)`) : `${v} as String${q}`;
            case "integer": return `(${v} as num${q})${q}.toInt()`;
            case "number": return `(${v} as num${q})${q}.toDouble()`;
            case "boolean": return `${v} as bool${q}`;
            case "array": return `(${v} as List<dynamic>${q})${q}.map((e) => ${fromJson(t.item, "e", false)}).toList()`;
            case "object": return nullable ? `${v} == null ? null : ${nameOf.get(t)}.fromJson(${v} as Map<String, dynamic>)` : `${nameOf.get(t)}.fromJson(${v} as Map<String, dynamic>)`;
            default: return v;
        }
    };
    const toJson = (s, v, nullable) => {
        const t = nonNull(s);
        const q = nullable ? "?" : "";
        if (isDateTime(t))
            return `${v}${q}.toIso8601String()`;
        if (t.kind === "object")
            return `${v}${q}.toJson()`;
        if (t.kind === "array" && (nonNull(t.item).kind === "object" || isDateTime(nonNull(t.item))))
            return `${v}${q}.map((e) => ${toJson(t.item, "e", false)}).toList()`;
        return v;
    };
    const fieldName = (key) => { const n = camel(key); return DART_RESERVED.has(n) ? `${n}Value` : n; };
    const classes = objects.map(({ name, shape }) => {
        const fields = [...shape.fields].map(([key, f]) => {
            const nullable = optional(shape, key) || nullable_(f.shape);
            return { key, name: fieldName(key), type: type(f.shape) + (nullable && type(f.shape) !== "dynamic" ? "?" : ""), nullable, shape: f.shape };
        });
        const ctor = `  const ${name}({\n${fields.map(f => `    ${f.nullable ? "" : "required "}this.${f.name},`).join("\n")}\n  });`;
        const decl = fields.map(f => `${style === "json_serializable" && f.name !== f.key ? `  @JsonKey(name: '${f.key}')\n` : ""}  final ${f.type} ${f.name};`).join("\n");
        if (style === "json_serializable") {
            return `@JsonSerializable(explicitToJson: true)\nclass ${name} {\n${ctor}\n\n${decl}\n\n  factory ${name}.fromJson(Map<String, dynamic> json) => _$${name}FromJson(json);\n\n  Map<String, dynamic> toJson() => _$${name}ToJson(this);\n}`;
        }
        const from = fields.map(f => `        ${f.name}: ${fromJson(f.shape, `json['${f.key}']`, f.nullable)},`).join("\n");
        const to = fields.map(f => `        '${f.key}': ${toJson(f.shape, f.name, f.nullable)},`).join("\n");
        const copyWith = `  ${name} copyWith({\n${fields.map(f => `    ${f.type.endsWith("?") || f.type === "dynamic" ? f.type : `${f.type}?`} ${f.name},`).join("\n")}\n  }) =>\n      ${name}(\n${fields.map(f => `        ${f.name}: ${f.name} ?? this.${f.name},`).join("\n")}\n      );`;
        return `class ${name} {\n${ctor}\n\n${decl}\n\n  factory ${name}.fromJson(Map<String, dynamic> json) => ${name}(\n${from}\n      );\n\n  Map<String, dynamic> toJson() => {\n${to}\n      };\n\n${copyWith}\n}`;
    });
    const file = snake(rootName);
    const head = style === "json_serializable" ? `import 'package:json_annotation/json_annotation.dart';\n\npart '${file}.g.dart';\n\n// Generate the part file: dart run build_runner build --delete-conflicting-outputs\n\n` : "";
    return `${head}${classes.join("\n\n")}\n`;
}
exports.toDart = toDart;
function nullable_(s) {
    return s.kind === "null" || (s.kind === "union" && s.options.some(o => o.kind === "null"));
}
const KOTLIN_RESERVED = new Set("as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while".split(" "));
function toKotlin(root, rootName, style, packageName) {
    if (root.kind !== "object")
        throw new types_1.ToolInputError("Kotlin data classes need a JSON object (or an array of objects).");
    const { objects, nameOf } = collectObjects(root, rootName);
    const type = (s) => {
        const t = nonNull(s);
        switch (t.kind) {
            case "string": return "String";
            case "integer": return "Long";
            case "number": return "Double";
            case "boolean": return "Boolean";
            case "array": return `List<${type(t.item)}>`;
            case "object": return nameOf.get(t);
            default: return style === "kotlinx" ? "JsonElement" : "Any";
        }
    };
    let usesJsonElement = false;
    const classes = [...objects].map(({ name, shape }) => {
        const props = [...shape.fields].map(([key, f]) => {
            let n = camel(key);
            if (KOTLIN_RESERVED.has(n))
                n = `\`${n}\``;
            const nullable = optional(shape, key) || nullable_(f.shape) || ["null", "unknown"].includes(nonNull(f.shape).kind);
            const t = type(f.shape);
            if (t.includes("JsonElement"))
                usesJsonElement = true;
            const ann = n.replace(/`/g, "") !== key ? (style === "kotlinx" ? `@SerialName("${key}") ` : style === "moshi" ? `@Json(name = "${key}") ` : `@SerializedName("${key}") `) : "";
            const note = isDateTime(nonNull(f.shape)) ? " // ISO-8601; parse with Instant.parse()" : "";
            return `    ${ann}val ${n}: ${t}${nullable ? "? = null" : ""},${note}`;
        });
        const annotation = style === "kotlinx" ? "@Serializable\n" : style === "moshi" ? "@JsonClass(generateAdapter = true)\n" : "";
        return `${annotation}data class ${name}(\n${props.join("\n")}\n)`;
    });
    const imports = style === "kotlinx" ? ["kotlinx.serialization.SerialName", "kotlinx.serialization.Serializable", ...(usesJsonElement ? ["kotlinx.serialization.json.JsonElement"] : [])] : style === "moshi" ? ["com.squareup.moshi.Json", "com.squareup.moshi.JsonClass"] : ["com.google.gson.annotations.SerializedName"];
    const usage = style === "kotlinx" ? `\n// val json = Json { ignoreUnknownKeys = true }\n// val ${camel(rootName)} = json.decodeFromString<${pascal(rootName)}>(body)\n` : style === "moshi" ? `\n// val adapter = moshi.adapter(${pascal(rootName)}::class.java)\n` : `\n// Gson ignores Kotlin nullability and default values; prefer kotlinx.serialization or Moshi for new code.\n// val ${camel(rootName)} = Gson().fromJson(body, ${pascal(rootName)}::class.java)\n`;
    return `${packageName.trim() ? `package ${packageName.trim()}\n\n` : ""}${imports.map(i => `import ${i}`).join("\n")}\n${usage}\n${classes.join("\n\n")}\n`;
}
exports.toKotlin = toKotlin;
const SWIFT_RESERVED = new Set("associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try".split(" "));
function toSwift(root, rootName, mutable) {
    if (root.kind !== "object")
        throw new types_1.ToolInputError("Swift structs need a JSON object (or an array of objects).");
    const { objects, nameOf } = collectObjects(root, rootName);
    let usesDate = false;
    let usesAny = false;
    const type = (s) => {
        const t = nonNull(s);
        switch (t.kind) {
            case "string":
                if (isDateTime(t)) {
                    usesDate = true;
                    return "Date";
                }
                return t.formats.size === 1 && t.formats.has("uri") ? "URL" : t.formats.size === 1 && t.formats.has("uuid") ? "UUID" : "String";
            case "integer": return "Int";
            case "number": return "Double";
            case "boolean": return "Bool";
            case "array": return `[${type(t.item)}]`;
            case "object": return nameOf.get(t);
            default:
                usesAny = true;
                return "JSONValue";
        }
    };
    const structs = objects.map(({ name, shape }) => {
        const props = [...shape.fields].map(([key, f]) => {
            const n = camel(key);
            const nullable = optional(shape, key) || nullable_(f.shape) || ["null", "unknown"].includes(nonNull(f.shape).kind);
            return { key, name: SWIFT_RESERVED.has(n) ? `\`${n}\`` : n, plain: n, type: type(f.shape) + (nullable ? "?" : "") };
        });
        const needsKeys = props.some(p => p.plain !== p.key);
        const keys = needsKeys ? `\n\n    enum CodingKeys: String, CodingKey {\n${props.map(p => `        case ${p.name}${p.plain !== p.key ? ` = "${p.key}"` : ""}`).join("\n")}\n    }` : "";
        return `struct ${name}: Codable, Hashable {\n${props.map(p => `    ${mutable ? "var" : "let"} ${p.name}: ${p.type}`).join("\n")}${keys}\n}`;
    });
    const helper = usesAny ? `\n\n/// Any JSON value, for fields whose type varies or is unknown.\nenum JSONValue: Codable, Hashable {\n    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null\n\n    init(from decoder: Decoder) throws {\n        let c = try decoder.singleValueContainer()\n        if c.decodeNil() { self = .null }\n        else if let v = try? c.decode(Bool.self) { self = .bool(v) }\n        else if let v = try? c.decode(Double.self) { self = .number(v) }\n        else if let v = try? c.decode(String.self) { self = .string(v) }\n        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }\n        else { self = .object(try c.decode([String: JSONValue].self)) }\n    }\n\n    func encode(to encoder: Encoder) throws {\n        var c = encoder.singleValueContainer()\n        switch self {\n        case .string(let v): try c.encode(v)\n        case .number(let v): try c.encode(v)\n        case .bool(let v): try c.encode(v)\n        case .object(let v): try c.encode(v)\n        case .array(let v): try c.encode(v)\n        case .null: try c.encodeNil()\n        }\n    }\n}` : "";
    const usage = `\n\n// let decoder = JSONDecoder()${usesDate ? "\n// decoder.dateDecodingStrategy = .iso8601  // fractional seconds need a custom ISO8601DateFormatter" : ""}\n// let value = try decoder.decode(${pascal(rootName)}.self, from: data)`;
    return `import Foundation\n\n${structs.join("\n\n")}${helper}${usage}\n`;
}
exports.toSwift = toSwift;
//# sourceMappingURL=data-types.js.map