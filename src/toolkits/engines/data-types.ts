import { ToolInputError } from "../types";

/**
 * Type generation from example JSON. One inference pass builds a "shape"
 * that merges every example (all array elements), so optional fields,
 * nullable fields and mixed types are detected instead of guessed from the
 * first element.
 */

type StringFormat = "date-time" | "date" | "email" | "uri" | "uuid";

export type Shape =
  | { kind: "string"; formats: Set<StringFormat | "text"> }
  | { kind: "integer" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "null" }
  | { kind: "unknown" }
  | { kind: "array"; item: Shape }
  | { kind: "object"; fields: Map<string, { shape: Shape; count: number }>; samples: number }
  | { kind: "union"; options: Shape[] };

function stringFormat(value: string): StringFormat | "text" {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(value)) return "date-time";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "email";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return "uuid";
  if (/^https?:\/\/\S+$/.test(value)) return "uri";
  return "text";
}

export function shapeOf(value: unknown): Shape {
  if (value === null || value === undefined) return { kind: "null" };
  if (typeof value === "string") return { kind: "string", formats: new Set([stringFormat(value)]) };
  if (typeof value === "number") return Number.isInteger(value) ? { kind: "integer" } : { kind: "number" };
  if (typeof value === "boolean") return { kind: "boolean" };
  if (Array.isArray(value)) return { kind: "array", item: value.length ? value.map(shapeOf).reduce(merge) : { kind: "unknown" } };
  const fields = new Map<string, { shape: Shape; count: number }>();
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) fields.set(key, { shape: shapeOf(v), count: 1 });
  return { kind: "object", fields, samples: 1 };
}

export function merge(a: Shape, b: Shape): Shape {
  if (a.kind === "unknown") return b;
  if (b.kind === "unknown") return a;
  if (a.kind === "union" || b.kind === "union") {
    const options = [...(a.kind === "union" ? a.options : [a])];
    for (const option of b.kind === "union" ? b.options : [b]) {
      const index = options.findIndex(o => compatible(o, option));
      if (index >= 0) options[index] = merge(options[index], option);
      else options.push(option);
    }
    return options.length === 1 ? options[0] : { kind: "union", options };
  }
  if ((a.kind === "integer" && b.kind === "number") || (a.kind === "number" && b.kind === "integer")) return { kind: "number" };
  if (a.kind !== b.kind) return { kind: "union", options: [a, b] };
  switch (a.kind) {
    case "string": return { kind: "string", formats: new Set([...a.formats, ...(b as typeof a).formats]) };
    case "array": return { kind: "array", item: merge(a.item, (b as typeof a).item) };
    case "object": {
      const other = b as typeof a;
      const fields = new Map<string, { shape: Shape; count: number }>();
      for (const [key, f] of a.fields) fields.set(key, { ...f });
      for (const [key, f] of other.fields) {
        const existing = fields.get(key);
        fields.set(key, existing ? { shape: merge(existing.shape, f.shape), count: existing.count + f.count } : { ...f });
      }
      return { kind: "object", fields, samples: a.samples + other.samples };
    }
    default: return a;
  }
}

function compatible(a: Shape, b: Shape): boolean {
  if (a.kind === b.kind) return true;
  return (a.kind === "integer" && b.kind === "number") || (a.kind === "number" && b.kind === "integer");
}

/** The shape of one record: for an array input, all elements merged. */
export function recordShape(value: unknown): Shape {
  if (Array.isArray(value)) {
    if (!value.length) throw new ToolInputError("The array is empty; add at least one example element.");
    return value.map(shapeOf).reduce(merge);
  }
  return shapeOf(value);
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export function pascal(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+/g, " ").trim();
  const result = cleaned.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("") || "Item";
  return /^\d/.test(result) ? `T${result}` : result;
}

export function camel(name: string): string {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

export function snake(name: string): string {
  const result = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "field";
  return /^\d/.test(result) ? `f_${result}` : result;
}

function singular(name: string): string {
  if (/ies$/i.test(name)) return name.slice(0, -3) + "y";
  if (/(ss|us)$/i.test(name)) return name;
  if (/ses$/i.test(name)) return name.slice(0, -2);
  if (/s$/i.test(name) && name.length > 3) return name.slice(0, -1);
  return `${name}Item`;
}

interface NamedObject { name: string; shape: Extract<Shape, { kind: "object" }> }

/** Walks the shape and assigns a unique type name to every nested object. */
function collectObjects(root: Shape, rootName: string): { objects: NamedObject[]; nameOf: Map<Shape, string> } {
  const objects: NamedObject[] = [];
  const nameOf = new Map<Shape, string>();
  const used = new Set<string>();
  const unique = (base: string) => {
    let name = pascal(base);
    let n = 2;
    while (used.has(name)) name = `${pascal(base)}${n++}`;
    used.add(name);
    return name;
  };
  const visit = (shape: Shape, hint: string) => {
    if (shape.kind === "object") {
      const name = unique(hint);
      nameOf.set(shape, name);
      objects.push({ name, shape });
      for (const [key, field] of shape.fields) visit(field.shape, key);
    } else if (shape.kind === "array") visit(shape.item, singular(hint));
    else if (shape.kind === "union") shape.options.forEach(o => visit(o, hint));
  };
  visit(root, rootName);
  return { objects, nameOf };
}

const optional = (shape: NamedObject["shape"], key: string) => shape.fields.get(key)!.count < shape.samples;
const nullable = (s: Shape) => s.kind === "null" || (s.kind === "union" && s.options.some(o => o.kind === "null"));

const validIdentifier = (key: string) => /^[A-Za-z_$][\w$]*$/.test(key);

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

export function toTypeScript(root: Shape, rootName: string, style: "interface" | "type" | "zod"): string {
  const { objects, nameOf } = collectObjects(root, rootName);
  if (style === "zod") {
    const zod = (s: Shape): string => {
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
        case "object": return `${camel(nameOf.get(s)!)}Schema`;
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
  const ts = (s: Shape): string => {
    switch (s.kind) {
      case "string": return "string";
      case "integer": case "number": return "number";
      case "boolean": return "boolean";
      case "null": return "null";
      case "unknown": return "unknown";
      case "array": {
        const inner = ts(s.item);
        return /[|&]/.test(inner) ? `Array<${inner}>` : `${inner}[]`;
      }
      case "object": return nameOf.get(s)!;
      case "union": return s.options.map(ts).join(" | ");
    }
  };
  if (root.kind !== "object") return `export type ${pascal(rootName)} = ${ts(root)};\n`;
  const blocks = objects.map(({ name, shape }) => {
    const fields = [...shape.fields].map(([key, f]) => `  ${validIdentifier(key) ? key : JSON.stringify(key)}${optional(shape, key) ? "?" : ""}: ${ts(f.shape)};`);
    return style === "type" ? `export type ${name} = {\n${fields.join("\n")}\n};` : `export interface ${name} {\n${fields.join("\n")}\n}`;
  });
  return blocks.join("\n\n") + "\n";
}

export function toPython(root: Shape, rootName: string, style: "pydantic" | "dataclass" | "typeddict"): string {
  const { objects, nameOf } = collectObjects(root, rootName);
  const imports = new Set<string>();
  const py = (s: Shape): string => {
    switch (s.kind) {
      case "string": {
        const f = s.formats.size === 1 ? [...s.formats][0] : "text";
        if (f === "date-time") { imports.add("from datetime import datetime"); return "datetime"; }
        if (f === "date") { imports.add("from datetime import date"); return "date"; }
        if (f === "uuid") { imports.add("from uuid import UUID"); return "UUID"; }
        return "str";
      }
      case "integer": return "int";
      case "number": return "float";
      case "boolean": return "bool";
      case "null": return "None";
      case "unknown": imports.add("from typing import Any"); return "Any";
      case "array": return `list[${py(s.item)}]`;
      case "object": return nameOf.get(s)!;
      case "union": return s.options.map(py).join(" | ");
    }
  };
  if (root.kind !== "object") return `${pascal(rootName)} = ${py(root)}\n`;
  const blocks = [...objects].reverse().map(({ name, shape }) => {
    const required: string[] = [];
    const optionalFields: string[] = [];
    for (const [key, f] of shape.fields) {
      const field = snake(key);
      const isOptional = optional(shape, key);
      let type = py(f.shape);
      if (isOptional && !nullable(f.shape)) type = `${type} | None`;
      let line: string;
      if (style === "pydantic") {
        const alias = field !== key ? `alias=${JSON.stringify(key)}` : "";
        if (alias) imports.add("from pydantic import Field");
        line = `    ${field}: ${type}${alias ? ` = Field(${isOptional ? "default=None, " : ""}${alias})` : isOptional ? " = None" : ""}`;
      } else if (style === "typeddict") {
        if (isOptional) imports.add("from typing import NotRequired");
        line = `    ${field}: ${isOptional ? `NotRequired[${type}]` : type}`;
      } else {
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

const JAVA_KEYWORDS = new Set("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while record var yield".split(" "));

export function toJava(root: Shape, rootName: string, style: "record" | "pojo", packageName: string): string {
  const { objects, nameOf } = collectObjects(root, rootName);
  const imports = new Set<string>();
  const java = (s: Shape, boxed = true): string => {
    switch (s.kind) {
      case "string": {
        const f = s.formats.size === 1 ? [...s.formats][0] : "text";
        if (f === "date-time") { imports.add("java.time.OffsetDateTime"); return "OffsetDateTime"; }
        if (f === "date") { imports.add("java.time.LocalDate"); return "LocalDate"; }
        if (f === "uuid") { imports.add("java.util.UUID"); return "UUID"; }
        return "String";
      }
      case "integer": return boxed ? "Long" : "long";
      case "number": return boxed ? "Double" : "double";
      case "boolean": return boxed ? "Boolean" : "boolean";
      case "null": case "unknown": return "Object";
      case "array": imports.add("java.util.List"); return `List<${java(s.item)}>`;
      case "object": return nameOf.get(s)!;
      case "union": {
        const rest = s.options.filter(o => o.kind !== "null");
        return rest.length === 1 ? java(rest[0]) : "Object";
      }
    }
  };
  if (root.kind !== "object") throw new ToolInputError("Java classes need a JSON object (or an array of objects) as input.");
  const fieldName = (key: string) => {
    const name = camel(key);
    return JAVA_KEYWORDS.has(name) ? `${name}Value` : name;
  };
  const types = objects.map(({ name, shape }) => {
    const fields = [...shape.fields].map(([key, f]) => ({ key, name: fieldName(key), type: java(f.shape, optional(shape, key) || nullable(f.shape)) }));
    const needsAnnotation = fields.some(f => f.name !== f.key);
    if (needsAnnotation) imports.add("com.fasterxml.jackson.annotation.JsonProperty");
    const ann = (f: { key: string; name: string }) => (f.name !== f.key ? `@JsonProperty(${JSON.stringify(f.key)}) ` : "");
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

export function toGo(root: Shape, rootName: string): string {
  const { objects, nameOf } = collectObjects(root, rootName);
  let needsTime = false;
  const go = (s: Shape): string => {
    switch (s.kind) {
      case "string": {
        if (s.formats.size === 1 && s.formats.has("date-time")) { needsTime = true; return "time.Time"; }
        return "string";
      }
      case "integer": return "int64";
      case "number": return "float64";
      case "boolean": return "bool";
      case "null": case "unknown": return "any";
      case "array": return `[]${go(s.item)}`;
      case "object": return nameOf.get(s)!;
      case "union": {
        const rest = s.options.filter(o => o.kind !== "null");
        return rest.length === 1 ? `*${go(rest[0])}` : "any";
      }
    }
  };
  if (root.kind !== "object") return `type ${pascal(rootName)} ${go(root)}\n`;
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

export function toJsonSchema(root: Shape, title: string): Record<string, unknown> {
  const schema = (s: Shape): Record<string, unknown> => {
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
        const properties: Record<string, unknown> = {};
        const required: string[] = [];
        for (const [key, f] of s.fields) {
          properties[key] = schema(f.shape);
          if (f.count === s.samples) required.push(key);
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
