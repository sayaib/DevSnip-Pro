"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sqlToMongo = exports.compactJs = exports.connectionSnippets = exports.connectionWarnings = exports.parseConnectionUrl = exports.buildConnectionUrl = exports.scaffoldResource = exports.parseFields = exports.pluralOf = exports.kebabOf = exports.camelOf = exports.pascalOf = exports.words = exports.reactScaffold = void 0;
var react_generator_1 = require("./react-generator");
Object.defineProperty(exports, "reactScaffold", { enumerable: true, get: function () { return react_generator_1.reactScaffold; } });
const types_1 = require("../types");
/**
 * Code scaffolding for the stacks full-stack developers use every day:
 * a CRUD API resource (Express, NestJS, Next.js route handlers, Fastify on
 * Prisma, Mongoose or memory) and React / Next.js / React Native building
 * blocks. Output is plain, dependency-light TypeScript that compiles.
 */
// ---------------------------------------------------------------------------
// Names and fields
// ---------------------------------------------------------------------------
const scaffold_names_1 = require("./scaffold-names");
var scaffold_names_2 = require("./scaffold-names");
Object.defineProperty(exports, "words", { enumerable: true, get: function () { return scaffold_names_2.words; } });
Object.defineProperty(exports, "pascalOf", { enumerable: true, get: function () { return scaffold_names_2.pascalOf; } });
Object.defineProperty(exports, "camelOf", { enumerable: true, get: function () { return scaffold_names_2.camelOf; } });
Object.defineProperty(exports, "kebabOf", { enumerable: true, get: function () { return scaffold_names_2.kebabOf; } });
Object.defineProperty(exports, "pluralOf", { enumerable: true, get: function () { return scaffold_names_2.pluralOf; } });
const TYPE_ALIASES = { str: "string", string: "string", text: "text", int: "int", integer: "int", number: "number", float: "number", decimal: "number", double: "number", bool: "boolean", boolean: "boolean", date: "date", datetime: "date", timestamp: "date", email: "email", url: "url", uri: "url", uuid: "uuid", json: "json", object: "json", "string[]": "string[]", "number[]": "number[]", "int[]": "number[]", tags: "string[]" };
/** Lines like "price: number!", "status: enum(draft|published)", "email: email! unique", "tags: string[]". */
function parseFields(text) {
    const fields = [];
    for (const raw of text.split(/[\n,]+/).map(s => s.trim()).filter(s => s && !s.startsWith("#"))) {
        const m = /^([A-Za-z_][\w]*)\s*[: ]\s*([A-Za-z\[\]]+)(\(([^)]*)\))?\s*(!|\?)?\s*(unique)?$/i.exec(raw);
        if (!m)
            throw new types_1.ToolInputError(`Cannot read the field "${raw}". Use name: type, e.g. "price: number!" or "status: enum(draft|published)".`);
        const typeKey = m[2].toLowerCase();
        const type = typeKey === "enum" ? "enum" : TYPE_ALIASES[typeKey];
        if (!type)
            throw new types_1.ToolInputError(`Unknown type "${m[2]}" for ${m[1]}. Use string, text, int, number, boolean, date, email, url, uuid, enum(a|b), string[], number[] or json.`);
        const values = type === "enum" ? (m[4] ?? "").split(/[|/]/).map(s => s.trim()).filter(Boolean) : [];
        if (type === "enum" && !values.length)
            throw new types_1.ToolInputError(`${m[1]}: list the enum values, e.g. enum(draft|published).`);
        if (["id", "createdAt", "updatedAt", "_id"].includes(m[1]))
            continue;
        fields.push({ name: m[1], type, required: m[5] === "!", unique: !!m[6], values });
    }
    if (!fields.length)
        throw new types_1.ToolInputError("Add at least one field, e.g. \"name: string!\".");
    return fields;
}
exports.parseFields = parseFields;
const tsType = (f) => ({ string: "string", text: "string", int: "number", number: "number", boolean: "boolean", date: "Date", email: "string", url: "string", uuid: "string", enum: f.values.map(v => JSON.stringify(v)).join(" | "), "string[]": "string[]", "number[]": "number[]", json: "Record<string, unknown>" }[f.type]);
function zodOf(f) {
    const base = { string: "z.string().trim().min(1).max(255)", text: "z.string().max(10000)", int: "z.number().int()", number: "z.number()", boolean: "z.boolean()", date: "z.coerce.date()", email: "z.string().email()", url: "z.string().url()", uuid: "z.string().uuid()", enum: `z.enum([${f.values.map(v => JSON.stringify(v)).join(", ")}])`, "string[]": "z.array(z.string())", "number[]": "z.array(z.number())", json: "z.record(z.string(), z.unknown())" }[f.type];
    return f.required ? base : `${base}.optional()`;
}
function prismaOf(f) {
    const t = { string: "String", text: "String", int: "Int", number: "Float", boolean: "Boolean", date: "DateTime", email: "String", url: "String", uuid: "String", enum: "String", "string[]": "String[]", "number[]": "Float[]", json: "Json" }[f.type];
    const list = t.endsWith("[]");
    return `  ${f.name.padEnd(12)} ${t}${f.required || list ? "" : "?"}${f.unique ? " @unique" : ""}${f.type === "text" ? " @db.Text" : ""}${f.type === "enum" ? ` // ${f.values.join(" | ")}` : ""}`;
}
function mongooseOf(f) {
    const t = { string: "String", text: "String", int: "Number", number: "Number", boolean: "Boolean", date: "Date", email: "String", url: "String", uuid: "String", enum: "String", "string[]": "[String]", "number[]": "[Number]", json: "Schema.Types.Mixed" }[f.type];
    const opts = [`type: ${t}`, ...(f.required ? ["required: true"] : []), ...(f.unique ? ["unique: true"] : []), ...(f.type === "enum" ? [`enum: ${JSON.stringify(f.values)}`] : []), ...(f.type === "email" ? ["lowercase: true", "trim: true"] : []), ...(["string", "text"].includes(f.type) ? ["trim: true"] : [])];
    return `    ${f.name}: { ${opts.join(", ")} },`;
}
function validatorOf(f) {
    const d = [];
    if (!f.required)
        d.push("@IsOptional()");
    switch (f.type) {
        case "string":
            d.push("@IsString()", "@MaxLength(255)");
            break;
        case "text":
            d.push("@IsString()");
            break;
        case "int":
            d.push("@IsInt()");
            break;
        case "number":
            d.push("@IsNumber()");
            break;
        case "boolean":
            d.push("@IsBoolean()");
            break;
        case "date":
            d.push("@IsDateString()");
            break;
        case "email":
            d.push("@IsEmail()");
            break;
        case "url":
            d.push("@IsUrl()");
            break;
        case "uuid":
            d.push("@IsUUID()");
            break;
        case "enum":
            d.push(`@IsIn(${JSON.stringify(f.values)})`);
            break;
        case "string[]":
            d.push("@IsArray()", "@IsString({ each: true })");
            break;
        case "number[]":
            d.push("@IsArray()", "@IsNumber({}, { each: true })");
            break;
        case "json":
            d.push("@IsObject()");
            break;
    }
    return { decorators: d, imports: d.map(x => /^@(\w+)/.exec(x)[1]) };
}
function jsonSchemaOf(f) {
    const s = { string: { type: "string", minLength: 1, maxLength: 255 }, text: { type: "string" }, int: { type: "integer" }, number: { type: "number" }, boolean: { type: "boolean" }, date: { type: "string", format: "date-time" }, email: { type: "string", format: "email" }, url: { type: "string", format: "uri" }, uuid: { type: "string", format: "uuid" }, enum: { type: "string", enum: f.values }, "string[]": { type: "array", items: { type: "string" } }, "number[]": { type: "array", items: { type: "number" } }, json: { type: "object" } }[f.type];
    return JSON.stringify(s);
}
function scaffoldResource(resource, fields, framework, db) {
    if (!/^[A-Za-z][A-Za-z0-9 _-]*$/.test(resource.trim()))
        throw new types_1.ToolInputError("The resource name should be a word like product or blogPost.");
    const R = (0, scaffold_names_1.pascalOf)(resource);
    const r = (0, scaffold_names_1.camelOf)(resource);
    const plural = (0, scaffold_names_1.pluralOf)((0, scaffold_names_1.kebabOf)(resource));
    const rs = (0, scaffold_names_1.camelOf)((0, scaffold_names_1.pluralOf)(r));
    if (framework === "nestjs")
        return nest(R, r, rs, plural, fields, db);
    const dir = framework === "next" ? "lib" : `src/${plural}`;
    const files = [];
    const steps = [];
    const idType = db === "mongoose" ? "string" : db === "prisma" ? "string" : "string";
    files.push({ path: `${dir}/${(0, scaffold_names_1.kebabOf)(resource)}.schema.ts`, language: "typescript", content: `import { z } from "zod";\n\nexport const create${R}Schema = z.object({\n${fields.map(f => `  ${f.name}: ${zodOf(f)},`).join("\n")}\n});\n\nexport const update${R}Schema = create${R}Schema.partial();\n\nexport const list${R}QuerySchema = z.object({\n  page: z.coerce.number().int().min(1).default(1),\n  limit: z.coerce.number().int().min(1).max(100).default(20),\n});\n\nexport type Create${R}Input = z.infer<typeof create${R}Schema>;\nexport type Update${R}Input = z.infer<typeof update${R}Schema>;\n\nexport interface ${R} {\n  id: ${idType};\n${fields.map(f => `  ${f.name}${f.required ? "" : "?"}: ${tsType(f)};`).join("\n")}\n  createdAt: Date;\n  updatedAt: Date;\n}\n` });
    files.push(...repository(R, r, rs, dir, fields, db, resource));
    steps.push(`npm install zod${db === "prisma" ? " @prisma/client && npm install -D prisma" : db === "mongoose" ? " mongoose" : ""}`);
    if (db === "prisma")
        steps.push(`Add the model to prisma/schema.prisma, then: npx prisma migrate dev --name add_${r}`);
    if (db === "mongoose")
        steps.push("Connect once at startup: await mongoose.connect(process.env.MONGODB_URI!)");
    const repo = `./${(0, scaffold_names_1.kebabOf)(resource)}.repository`;
    const schema = `./${(0, scaffold_names_1.kebabOf)(resource)}.schema`;
    if (framework === "express") {
        steps.unshift("npm install express && npm install -D @types/express");
        steps.push(`Mount the router: app.use(express.json()); app.use("/api/${plural}", ${rs}Router);`);
        files.push({ path: `${dir}/${(0, scaffold_names_1.kebabOf)(resource)}.routes.ts`, language: "typescript", content: `import { NextFunction, Request, Response, Router } from "express";\nimport { ZodError } from "zod";\nimport { create${R}Schema, list${R}QuerySchema, update${R}Schema } from "${schema}";\nimport * as repo from "${repo}";\n\nexport const ${rs}Router = Router();\n\n// Express 4 does not catch rejected promises; this forwards them to the error handler.\nconst handle = (fn: (req: Request, res: Response) => Promise<unknown>) =>\n  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);\n\n${rs}Router.get("/", handle(async (req, res) => {\n  const { page, limit } = list${R}QuerySchema.parse(req.query);\n  const [items, total] = await Promise.all([repo.list${(0, scaffold_names_1.pascalOf)(rs)}((page - 1) * limit, limit), repo.count${(0, scaffold_names_1.pascalOf)(rs)}()]);\n  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });\n}));\n\n${rs}Router.get("/:id", handle(async (req, res) => {\n  const item = await repo.get${R}(req.params.id);\n  if (!item) return res.status(404).json({ error: "${R} not found" });\n  res.json(item);\n}));\n\n${rs}Router.post("/", handle(async (req, res) => {\n  const input = create${R}Schema.parse(req.body);\n  res.status(201).json(await repo.create${R}(input));\n}));\n\n${rs}Router.patch("/:id", handle(async (req, res) => {\n  const input = update${R}Schema.parse(req.body);\n  const item = await repo.update${R}(req.params.id, input);\n  if (!item) return res.status(404).json({ error: "${R} not found" });\n  res.json(item);\n}));\n\n${rs}Router.delete("/:id", handle(async (req, res) => {\n  const deleted = await repo.delete${R}(req.params.id);\n  if (!deleted) return res.status(404).json({ error: "${R} not found" });\n  res.status(204).end();\n}));\n\n// Validation errors become 400s; everything else is a 500 without internals.\n${rs}Router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {\n  if (err instanceof ZodError) return res.status(400).json({ error: "Validation failed", issues: err.issues });\n  next(err);\n});\n` });
    }
    else if (framework === "fastify") {
        steps.unshift("npm install fastify");
        steps.push(`Register the plugin: app.register(${rs}Routes, { prefix: "/api/${plural}" });`);
        const props = fields.map(f => `    ${f.name}: ${jsonSchemaOf(f)},`).join("\n");
        files.push({ path: `${dir}/${(0, scaffold_names_1.kebabOf)(resource)}.routes.ts`, language: "typescript", content: `import { FastifyInstance } from "fastify";\nimport { Create${R}Input, Update${R}Input } from "${schema}";\nimport * as repo from "${repo}";\n\n// Fastify validates bodies with JSON Schema (Ajv) before the handler runs.\nconst properties = {\n${props}\n};\nconst createBody = { type: "object", properties, required: ${JSON.stringify(fields.filter(f => f.required).map(f => f.name))}, additionalProperties: false } as const;\nconst updateBody = { type: "object", properties, additionalProperties: false } as const;\nconst idParams = { type: "object", properties: { id: { type: "string" } }, required: ["id"] } as const;\nconst listQuery = { type: "object", properties: { page: { type: "integer", minimum: 1, default: 1 }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } } } as const;\n\nexport async function ${rs}Routes(app: FastifyInstance) {\n  app.get<{ Querystring: { page: number; limit: number } }>("/", { schema: { querystring: listQuery } }, async req => {\n    const { page, limit } = req.query;\n    const [items, total] = await Promise.all([repo.list${(0, scaffold_names_1.pascalOf)(rs)}((page - 1) * limit, limit), repo.count${(0, scaffold_names_1.pascalOf)(rs)}()]);\n    return { items, page, limit, total, pages: Math.ceil(total / limit) };\n  });\n\n  app.get<{ Params: { id: string } }>("/:id", { schema: { params: idParams } }, async (req, reply) => {\n    const item = await repo.get${R}(req.params.id);\n    return item ?? reply.code(404).send({ error: "${R} not found" });\n  });\n\n  app.post<{ Body: Create${R}Input }>("/", { schema: { body: createBody } }, async (req, reply) => {\n    return reply.code(201).send(await repo.create${R}(req.body));\n  });\n\n  app.patch<{ Params: { id: string }; Body: Update${R}Input }>("/:id", { schema: { params: idParams, body: updateBody } }, async (req, reply) => {\n    const item = await repo.update${R}(req.params.id, req.body);\n    return item ?? reply.code(404).send({ error: "${R} not found" });\n  });\n\n  app.delete<{ Params: { id: string } }>("/:id", { schema: { params: idParams } }, async (req, reply) => {\n    const deleted = await repo.delete${R}(req.params.id);\n    return deleted ? reply.code(204).send() : reply.code(404).send({ error: "${R} not found" });\n  });\n}\n` });
    }
    else {
        const libImport = `@/lib/${(0, scaffold_names_1.kebabOf)(resource)}`;
        files.push({ path: `app/api/${plural}/route.ts`, language: "typescript", content: `import { NextRequest, NextResponse } from "next/server";\nimport { ZodError } from "zod";\nimport { create${R}Schema, list${R}QuerySchema } from "${libImport}.schema";\nimport * as repo from "${libImport}.repository";\n\nexport async function GET(request: NextRequest) {\n  const { page, limit } = list${R}QuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));\n  const [items, total] = await Promise.all([repo.list${(0, scaffold_names_1.pascalOf)(rs)}((page - 1) * limit, limit), repo.count${(0, scaffold_names_1.pascalOf)(rs)}()]);\n  return NextResponse.json({ items, page, limit, total, pages: Math.ceil(total / limit) });\n}\n\nexport async function POST(request: NextRequest) {\n  try {\n    const input = create${R}Schema.parse(await request.json());\n    return NextResponse.json(await repo.create${R}(input), { status: 201 });\n  } catch (error) {\n    if (error instanceof ZodError) return NextResponse.json({ error: "Validation failed", issues: error.issues }, { status: 400 });\n    if (error instanceof SyntaxError) return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });\n    throw error;\n  }\n}\n` });
        files.push({ path: `app/api/${plural}/[id]/route.ts`, language: "typescript", content: `import { NextRequest, NextResponse } from "next/server";\nimport { ZodError } from "zod";\nimport { update${R}Schema } from "${libImport}.schema";\nimport * as repo from "${libImport}.repository";\n\n// Next.js 15+: route params are a Promise.\ntype Context = { params: Promise<{ id: string }> };\n\nexport async function GET(_request: NextRequest, { params }: Context) {\n  const { id } = await params;\n  const item = await repo.get${R}(id);\n  return item ? NextResponse.json(item) : NextResponse.json({ error: "${R} not found" }, { status: 404 });\n}\n\nexport async function PATCH(request: NextRequest, { params }: Context) {\n  const { id } = await params;\n  try {\n    const item = await repo.update${R}(id, update${R}Schema.parse(await request.json()));\n    return item ? NextResponse.json(item) : NextResponse.json({ error: "${R} not found" }, { status: 404 });\n  } catch (error) {\n    if (error instanceof ZodError) return NextResponse.json({ error: "Validation failed", issues: error.issues }, { status: 400 });\n    throw error;\n  }\n}\n\nexport async function DELETE(_request: NextRequest, { params }: Context) {\n  const { id } = await params;\n  const deleted = await repo.delete${R}(id);\n  return deleted ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "${R} not found" }, { status: 404 });\n}\n` });
    }
    return { files, steps };
}
exports.scaffoldResource = scaffoldResource;
function repository(R, r, rs, dir, fields, db, resource) {
    const Rs = (0, scaffold_names_1.pascalOf)(rs);
    const header = `import { Create${R}Input, ${R}, Update${R}Input } from "./${(0, scaffold_names_1.kebabOf)(resource)}.schema";\n`;
    const files = [];
    if (db === "memory") {
        files.push({ path: `${dir}/${(0, scaffold_names_1.kebabOf)(resource)}.repository.ts`, language: "typescript", content: `import { randomUUID } from "node:crypto";\n${header}\n// In-memory store for prototypes and tests; swap for a database before production.\nconst store = new Map<string, ${R}>();\n\nexport async function list${Rs}(skip: number, take: number): Promise<${R}[]> {\n  return [...store.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(skip, skip + take);\n}\n\nexport async function count${Rs}(): Promise<number> {\n  return store.size;\n}\n\nexport async function get${R}(id: string): Promise<${R} | undefined> {\n  return store.get(id);\n}\n\nexport async function create${R}(input: Create${R}Input): Promise<${R}> {\n  const now = new Date();\n  const item: ${R} = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };\n  store.set(item.id, item);\n  return item;\n}\n\nexport async function update${R}(id: string, input: Update${R}Input): Promise<${R} | undefined> {\n  const existing = store.get(id);\n  if (!existing) return undefined;\n  const item: ${R} = { ...existing, ...input, updatedAt: new Date() };\n  store.set(id, item);\n  return item;\n}\n\nexport async function delete${R}(id: string): Promise<boolean> {\n  return store.delete(id);\n}\n` });
    }
    else if (db === "prisma") {
        files.push({ path: `${dir.startsWith("lib") ? "lib" : "src"}/prisma.ts`, language: "typescript", content: `import { PrismaClient } from "@prisma/client";\n\n// One client per process; reuse it across hot reloads in development.\nconst globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };\nexport const prisma = globalForPrisma.prisma ?? new PrismaClient();\nif (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;\n` });
        const prismaPath = dir.startsWith("lib") ? "./prisma" : "../prisma";
        files.push({ path: `${dir}/${(0, scaffold_names_1.kebabOf)(resource)}.repository.ts`, language: "typescript", content: `import { Prisma } from "@prisma/client";\nimport { prisma } from "${prismaPath}";\nimport { Create${R}Input, Update${R}Input } from "./${(0, scaffold_names_1.kebabOf)(resource)}.schema";\n\nexport function list${Rs}(skip: number, take: number) {\n  return prisma.${r}.findMany({ skip, take, orderBy: { createdAt: "desc" } });\n}\n\nexport function count${Rs}() {\n  return prisma.${r}.count();\n}\n\nexport function get${R}(id: string) {\n  return prisma.${r}.findUnique({ where: { id } });\n}\n\nexport function create${R}(input: Create${R}Input) {\n  return prisma.${r}.create({ data: input as Prisma.${R}CreateInput });\n}\n\nexport async function update${R}(id: string, input: Update${R}Input) {\n  try {\n    return await prisma.${r}.update({ where: { id }, data: input as Prisma.${R}UpdateInput });\n  } catch (error) {\n    // P2025: record to update not found\n    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;\n    throw error;\n  }\n}\n\nexport async function delete${R}(id: string) {\n  const { count } = await prisma.${r}.deleteMany({ where: { id } });\n  return count > 0;\n}\n` });
        files.push({ path: "prisma/schema.prisma", language: "prisma", mode: "append", content: `\nmodel ${R} {\n  id           String   @id @default(uuid())\n${fields.map(prismaOf).join("\n")}\n  createdAt    DateTime @default(now())\n  updatedAt    DateTime @updatedAt\n}\n` });
    }
    else {
        files.push({ path: `${dir}/${(0, scaffold_names_1.kebabOf)(resource)}.model.ts`, language: "typescript", content: `import { InferSchemaType, Schema, model, models, Model } from "mongoose";\n\nconst ${r}Schema = new Schema(\n  {\n${fields.map(mongooseOf).join("\n")}\n  },\n  {\n    timestamps: true,\n    // Expose "id" instead of "_id" and drop "__v" in JSON responses.\n    toJSON: { virtuals: true, versionKey: false, transform: (_doc, ret: Record<string, unknown>) => { delete ret._id; return ret; } },\n  },\n);\n\nexport type ${R}Document = InferSchemaType<typeof ${r}Schema>;\n// models.${R} avoids OverwriteModelError on hot reload (Next.js, nodemon).\nexport const ${R}Model = (models.${R} as Model<${R}Document>) ?? model("${R}", ${r}Schema);\n` });
        files.push({ path: `${dir}/${(0, scaffold_names_1.kebabOf)(resource)}.repository.ts`, language: "typescript", content: `import { isValidObjectId } from "mongoose";\nimport { ${R}Model } from "./${(0, scaffold_names_1.kebabOf)(resource)}.model";\nimport { Create${R}Input, Update${R}Input } from "./${(0, scaffold_names_1.kebabOf)(resource)}.schema";\n\nexport function list${Rs}(skip: number, take: number) {\n  return ${R}Model.find().sort({ createdAt: -1 }).skip(skip).limit(take);\n}\n\nexport function count${Rs}() {\n  return ${R}Model.countDocuments();\n}\n\nexport async function get${R}(id: string) {\n  // An invalid ObjectId would throw a CastError; treat it as "not found".\n  return isValidObjectId(id) ? ${R}Model.findById(id) : null;\n}\n\nexport function create${R}(input: Create${R}Input) {\n  return ${R}Model.create(input);\n}\n\nexport async function update${R}(id: string, input: Update${R}Input) {\n  return isValidObjectId(id) ? ${R}Model.findByIdAndUpdate(id, input, { new: true, runValidators: true }) : null;\n}\n\nexport async function delete${R}(id: string) {\n  if (!isValidObjectId(id)) return false;\n  return (await ${R}Model.findByIdAndDelete(id)) !== null;\n}\n` });
    }
    return files;
}
function nest(R, r, rs, plural, fields, db) {
    const dir = `src/${plural}`;
    const imports = new Set();
    const dtoFields = fields.map(f => {
        const v = validatorOf(f);
        v.imports.forEach(i => imports.add(i));
        return `${v.decorators.map(d => `  ${d}`).join("\n")}\n  ${f.name}${f.required ? "!" : "?"}: ${f.type === "date" ? "string" : tsType(f)};`;
    });
    const files = [
        { path: `${dir}/dto/create-${(0, scaffold_names_1.kebabOf)(r)}.dto.ts`, language: "typescript", content: `import { ${[...imports].sort().join(", ")} } from "class-validator";\n\nexport class Create${R}Dto {\n${dtoFields.join("\n\n")}\n}\n` },
        { path: `${dir}/dto/update-${(0, scaffold_names_1.kebabOf)(r)}.dto.ts`, language: "typescript", content: `import { PartialType } from "@nestjs/mapped-types";\nimport { Create${R}Dto } from "./create-${(0, scaffold_names_1.kebabOf)(r)}.dto";\n\nexport class Update${R}Dto extends PartialType(Create${R}Dto) {}\n` }
    ];
    const Rs = (0, scaffold_names_1.pascalOf)(rs);
    let serviceBody;
    let moduleImports = "";
    let moduleImportList = "";
    let providers = `${Rs}Service`;
    const steps = ["npm install class-validator class-transformer @nestjs/mapped-types", "Enable validation in main.ts: app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));", `Add ${Rs}Module to the imports of AppModule.`];
    if (db === "mongoose") {
        steps.unshift("npm install @nestjs/mongoose mongoose");
        files.push({ path: `${dir}/schemas/${(0, scaffold_names_1.kebabOf)(r)}.schema.ts`, language: "typescript", content: `import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";\nimport { HydratedDocument } from "mongoose";\n\nexport type ${R}Document = HydratedDocument<${R}>;\n\n@Schema({ timestamps: true })\nexport class ${R} {\n${fields.map(f => `  @Prop(${JSON.stringify({ ...(f.required ? { required: true } : {}), ...(f.unique ? { unique: true } : {}), ...(f.type === "enum" ? { enum: f.values } : {}), ...(f.type.endsWith("[]") ? { type: [f.type === "string[]" ? "String" : "Number"] } : {}) }).replace(/"(String|Number)"/g, "$1")})\n  ${f.name}${f.required ? "!" : "?"}: ${tsType(f)};`).join("\n\n")}\n}\n\nexport const ${R}Schema = SchemaFactory.createForClass(${R});\n` });
        moduleImports = `import { MongooseModule } from "@nestjs/mongoose";\nimport { ${R}, ${R}Schema } from "./schemas/${(0, scaffold_names_1.kebabOf)(r)}.schema";\n`;
        moduleImportList = `\n  imports: [MongooseModule.forFeature([{ name: ${R}.name, schema: ${R}Schema }])],`;
        serviceBody = `import { Injectable, NotFoundException } from "@nestjs/common";\nimport { InjectModel } from "@nestjs/mongoose";\nimport { isValidObjectId, Model } from "mongoose";\nimport { Create${R}Dto } from "./dto/create-${(0, scaffold_names_1.kebabOf)(r)}.dto";\nimport { Update${R}Dto } from "./dto/update-${(0, scaffold_names_1.kebabOf)(r)}.dto";\nimport { ${R}, ${R}Document } from "./schemas/${(0, scaffold_names_1.kebabOf)(r)}.schema";\n\n@Injectable()\nexport class ${Rs}Service {\n  constructor(@InjectModel(${R}.name) private readonly model: Model<${R}Document>) {}\n\n  async findAll(page: number, limit: number) {\n    const [items, total] = await Promise.all([\n      this.model.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).exec(),\n      this.model.countDocuments().exec(),\n    ]);\n    return { items, page, limit, total, pages: Math.ceil(total / limit) };\n  }\n\n  async findOne(id: string) {\n    const item = isValidObjectId(id) ? await this.model.findById(id).exec() : null;\n    if (!item) throw new NotFoundException("${R} not found");\n    return item;\n  }\n\n  create(dto: Create${R}Dto) {\n    return this.model.create(dto);\n  }\n\n  async update(id: string, dto: Update${R}Dto) {\n    const item = isValidObjectId(id) ? await this.model.findByIdAndUpdate(id, dto, { new: true, runValidators: true }).exec() : null;\n    if (!item) throw new NotFoundException("${R} not found");\n    return item;\n  }\n\n  async remove(id: string) {\n    const item = isValidObjectId(id) ? await this.model.findByIdAndDelete(id).exec() : null;\n    if (!item) throw new NotFoundException("${R} not found");\n  }\n}\n`;
    }
    else if (db === "prisma") {
        steps.unshift("npm install @prisma/client && npm install -D prisma");
        steps.push(`npx prisma migrate dev --name add_${r}`);
        files.push({ path: "src/prisma/prisma.service.ts", language: "typescript", content: `import { Injectable, OnModuleInit } from "@nestjs/common";\nimport { PrismaClient } from "@prisma/client";\n\n@Injectable()\nexport class PrismaService extends PrismaClient implements OnModuleInit {\n  async onModuleInit() {\n    await this.$connect();\n  }\n}\n` });
        files.push({ path: "prisma/schema.prisma", language: "prisma", mode: "append", content: `\nmodel ${R} {\n  id           String   @id @default(uuid())\n${fields.map(prismaOf).join("\n")}\n  createdAt    DateTime @default(now())\n  updatedAt    DateTime @updatedAt\n}\n` });
        moduleImports = `import { PrismaService } from "../prisma/prisma.service";\n`;
        providers = `${Rs}Service, PrismaService`;
        serviceBody = `import { Injectable, NotFoundException } from "@nestjs/common";\nimport { Prisma } from "@prisma/client";\nimport { PrismaService } from "../prisma/prisma.service";\nimport { Create${R}Dto } from "./dto/create-${(0, scaffold_names_1.kebabOf)(r)}.dto";\nimport { Update${R}Dto } from "./dto/update-${(0, scaffold_names_1.kebabOf)(r)}.dto";\n\n@Injectable()\nexport class ${Rs}Service {\n  constructor(private readonly prisma: PrismaService) {}\n\n  async findAll(page: number, limit: number) {\n    const [items, total] = await this.prisma.$transaction([\n      this.prisma.${r}.findMany({ skip: (page - 1) * limit, take: limit, orderBy: { createdAt: "desc" } }),\n      this.prisma.${r}.count(),\n    ]);\n    return { items, page, limit, total, pages: Math.ceil(total / limit) };\n  }\n\n  async findOne(id: string) {\n    const item = await this.prisma.${r}.findUnique({ where: { id } });\n    if (!item) throw new NotFoundException("${R} not found");\n    return item;\n  }\n\n  create(dto: Create${R}Dto) {\n    return this.prisma.${r}.create({ data: dto as Prisma.${R}CreateInput });\n  }\n\n  async update(id: string, dto: Update${R}Dto) {\n    await this.findOne(id);\n    return this.prisma.${r}.update({ where: { id }, data: dto as Prisma.${R}UpdateInput });\n  }\n\n  async remove(id: string) {\n    await this.findOne(id);\n    await this.prisma.${r}.delete({ where: { id } });\n  }\n}\n`;
    }
    else {
        serviceBody = `import { Injectable, NotFoundException } from "@nestjs/common";\nimport { randomUUID } from "node:crypto";\nimport { Create${R}Dto } from "./dto/create-${(0, scaffold_names_1.kebabOf)(r)}.dto";\nimport { Update${R}Dto } from "./dto/update-${(0, scaffold_names_1.kebabOf)(r)}.dto";\n\nexport type ${R} = Create${R}Dto & { id: string; createdAt: Date; updatedAt: Date };\n\n// In-memory store for prototypes and tests; swap for a database before production.\n@Injectable()\nexport class ${Rs}Service {\n  private readonly store = new Map<string, ${R}>();\n\n  findAll(page: number, limit: number) {\n    const all = [...this.store.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());\n    return { items: all.slice((page - 1) * limit, page * limit), page, limit, total: all.length, pages: Math.ceil(all.length / limit) };\n  }\n\n  findOne(id: string) {\n    const item = this.store.get(id);\n    if (!item) throw new NotFoundException("${R} not found");\n    return item;\n  }\n\n  create(dto: Create${R}Dto) {\n    const now = new Date();\n    const item: ${R} = { ...dto, id: randomUUID(), createdAt: now, updatedAt: now };\n    this.store.set(item.id, item);\n    return item;\n  }\n\n  update(id: string, dto: Update${R}Dto) {\n    const item = { ...this.findOne(id), ...dto, updatedAt: new Date() };\n    this.store.set(id, item);\n    return item;\n  }\n\n  remove(id: string) {\n    this.findOne(id);\n    this.store.delete(id);\n  }\n}\n`;
    }
    files.push({ path: `${dir}/${plural}.service.ts`, language: "typescript", content: serviceBody });
    files.push({ path: `${dir}/${plural}.controller.ts`, language: "typescript", content: `import { Body, Controller, DefaultValuePipe, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";\nimport { Create${R}Dto } from "./dto/create-${(0, scaffold_names_1.kebabOf)(r)}.dto";\nimport { Update${R}Dto } from "./dto/update-${(0, scaffold_names_1.kebabOf)(r)}.dto";\nimport { ${Rs}Service } from "./${plural}.service";\n\n@Controller("${plural}")\nexport class ${Rs}Controller {\n  constructor(private readonly service: ${Rs}Service) {}\n\n  @Get()\n  findAll(\n    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,\n    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit: number,\n  ) {\n    return this.service.findAll(Math.max(1, page), Math.min(100, Math.max(1, limit)));\n  }\n\n  @Get(":id")\n  findOne(@Param("id") id: string) {\n    return this.service.findOne(id);\n  }\n\n  @Post()\n  create(@Body() dto: Create${R}Dto) {\n    return this.service.create(dto);\n  }\n\n  @Patch(":id")\n  update(@Param("id") id: string, @Body() dto: Update${R}Dto) {\n    return this.service.update(id, dto);\n  }\n\n  @Delete(":id")\n  @HttpCode(204)\n  remove(@Param("id") id: string) {\n    return this.service.remove(id);\n  }\n}\n` });
    files.push({ path: `${dir}/${plural}.module.ts`, language: "typescript", content: `import { Module } from "@nestjs/common";\n${moduleImports}import { ${Rs}Controller } from "./${plural}.controller";\nimport { ${Rs}Service } from "./${plural}.service";\n\n@Module({${moduleImportList}\n  controllers: [${Rs}Controller],\n  providers: [${providers}],\n})\nexport class ${Rs}Module {}\n` });
    return { files, steps };
}
const DEFAULT_PORTS = { postgres: 5432, mysql: 3306, mongodb: 27017, "mongodb+srv": undefined, redis: 6379, sqlserver: 1433 };
const encPart = (s) => encodeURIComponent(s);
function buildConnectionUrl(p) {
    const scheme = p.kind === "redis" ? (p.ssl ? "rediss" : "redis") : p.kind === "postgres" ? "postgresql" : p.kind;
    if (p.kind === "sqlserver") {
        return `sqlserver://${p.host}:${p.port ?? 1433};database=${p.database};user=${p.user};password={${p.password.replace(/}/g, "}}")}};encrypt=${p.ssl}${p.options.map(([k, v]) => `;${k}=${v}`).join("")}`;
    }
    const auth = p.user || p.password ? `${encPart(p.user)}${p.password ? `:${encPart(p.password)}` : ""}@` : "";
    const port = p.kind === "mongodb+srv" || !p.port ? "" : `:${p.port}`;
    const opts = [...p.options];
    const has = (k) => opts.some(([x]) => x.toLowerCase() === k.toLowerCase());
    if (p.ssl && p.kind === "postgres" && !has("sslmode"))
        opts.push(["sslmode", "require"]);
    if (p.ssl && p.kind === "mysql" && !has("ssl-mode") && !has("sslaccept"))
        opts.push(["ssl-mode", "REQUIRED"]);
    if (p.ssl && p.kind === "mongodb" && !has("tls"))
        opts.push(["tls", "true"]);
    if (p.kind.startsWith("mongodb") && !has("retryWrites"))
        opts.push(["retryWrites", "true"], ["w", "majority"]);
    const db = p.kind === "redis" ? (p.database ? `/${p.database}` : "") : `/${encPart(p.database)}`;
    const query = opts.length ? `?${opts.map(([k, v]) => `${k}=${encPart(v)}`).join("&")}` : "";
    return `${scheme}://${auth}${p.host}${port}${db}${query}`;
}
exports.buildConnectionUrl = buildConnectionUrl;
function parseConnectionUrl(url) {
    const text = url.trim().replace(/^["']|["']$/g, "").replace(/^[A-Z_]+=/, "");
    if (/^(sqlserver|mssql):\/\/[^/]*;/i.test(text) || /^Server=/i.test(text)) {
        const kv = Object.fromEntries(text.replace(/^(sqlserver|mssql):\/\//i, "server=").split(";").filter(Boolean).map(p => { const i = p.indexOf("="); return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()]; }));
        const [host, port] = String(kv.server ?? kv["data source"] ?? "").replace(/^tcp:/, "").split(/[:,]/);
        return { kind: "sqlserver", host, port: port ? Number(port) : 1433, user: kv.user ?? kv["user id"] ?? kv.uid ?? "", password: String(kv.password ?? kv.pwd ?? "").replace(/^\{|\}$/g, ""), database: kv.database ?? kv["initial catalog"] ?? "", ssl: /true|yes/i.test(kv.encrypt ?? ""), options: [] };
    }
    const m = /^([a-z+]+):\/\//i.exec(text);
    if (!m)
        throw new types_1.ToolInputError("Paste a connection URL such as postgresql://user:pass@host:5432/db.");
    const scheme = m[1].toLowerCase();
    const kind = scheme === "postgres" || scheme === "postgresql" ? "postgres" : scheme === "mysql" || scheme === "mariadb" ? "mysql" : scheme === "mongodb" ? "mongodb" : scheme === "mongodb+srv" ? "mongodb+srv" : scheme === "redis" || scheme === "rediss" ? "redis" : undefined;
    if (!kind)
        throw new types_1.ToolInputError(`Unsupported scheme ${scheme}://. Supported: postgresql, mysql, mongodb, mongodb+srv, redis, rediss, sqlserver.`);
    // Mongo allows several hosts (a,b,c); URL() does not, so split manually.
    const rest = text.slice(m[0].length);
    // The last "@" before the query is the end of the credentials, even when an unencoded password contains "@" or "/".
    const head = rest.includes("?") ? rest.slice(0, rest.indexOf("?")) : rest;
    const at = head.lastIndexOf("@");
    const authPart = at >= 0 ? rest.slice(0, at) : "";
    const afterAuth = at >= 0 ? rest.slice(at + 1) : rest;
    const slash = afterAuth.search(/[/?]/);
    const hostPart = slash < 0 ? afterAuth : afterAuth.slice(0, slash);
    const pathQuery = slash < 0 ? "" : afterAuth.slice(slash);
    const [pathPart, queryPart = ""] = pathQuery.split("?");
    const colon = authPart.indexOf(":");
    const dec = (s) => { try {
        return decodeURIComponent(s);
    }
    catch {
        return s;
    } };
    const firstHost = hostPart.split(",")[0];
    const hp = /^\[([^\]]+)\](?::(\d+))?$/.exec(firstHost) ?? /^([^:]+)(?::(\d+))?$/.exec(firstHost);
    return {
        kind: scheme === "rediss" ? "redis" : kind,
        host: hostPart.includes(",") ? hostPart : hp?.[1] ?? hostPart,
        port: hostPart.includes(",") ? undefined : hp?.[2] ? Number(hp[2]) : DEFAULT_PORTS[kind],
        user: dec(colon < 0 ? authPart : authPart.slice(0, colon)),
        password: colon < 0 ? "" : dec(authPart.slice(colon + 1)),
        database: dec(pathPart.replace(/^\//, "")),
        ssl: scheme === "rediss" || scheme === "mongodb+srv" || /(sslmode=(require|verify)|ssl=true|tls=true|ssl-mode=required)/i.test(queryPart),
        options: queryPart.split("&").filter(Boolean).map(p => { const i = p.indexOf("="); return [dec(i < 0 ? p : p.slice(0, i)), dec(i < 0 ? "" : p.slice(i + 1))]; })
    };
}
exports.parseConnectionUrl = parseConnectionUrl;
function connectionWarnings(raw, p) {
    const w = [];
    if (raw && p.password && /[@#/?:%\s]/.test(p.password) && !raw.includes(encodeURIComponent(p.password)))
        w.push("The password contains characters that must be percent-encoded in a URL (@ # / ? : % or spaces). Use the encoded URL below.");
    if (!p.ssl && !/^(localhost|127\.0\.0\.1|db|postgres|mysql|mongo|redis|host\.docker\.internal)$/.test(p.host))
        w.push("TLS is off for a remote host: credentials and data travel in plain text. Managed databases (RDS, Neon, Supabase, Atlas, Upstash) require TLS.");
    if (p.kind === "postgres" && /pooler|pgbouncer|:6543/.test(`${p.host}:${p.port}`) && !p.options.some(([k]) => k === "pgbouncer"))
        w.push("This looks like a transaction pooler (PgBouncer / Supabase :6543). Prisma needs ?pgbouncer=true here, and migrations need a direct URL (directUrl).");
    if (p.password && /^(password|postgres|root|admin|secret|123456|changeme)$/i.test(p.password))
        w.push("The password is a default/weak value; never use it outside local development.");
    if (p.kind === "mongodb+srv" && p.port)
        w.push("mongodb+srv:// URLs must not include a port.");
    if (p.kind === "redis" && p.database && !/^\d+$/.test(p.database))
        w.push("Redis databases are numbers (0-15), e.g. redis://host:6379/0.");
    return w;
}
exports.connectionWarnings = connectionWarnings;
function connectionSnippets(p, envName) {
    const env = envName || "DATABASE_URL";
    const out = {};
    const redacted = buildConnectionUrl({ ...p, password: p.password ? "********" : "" });
    switch (p.kind) {
        case "postgres":
            out["node-postgres (pg)"] = `import { Pool } from "pg";\n\nexport const pool = new Pool({\n  connectionString: process.env.${env},\n  max: 10,\n  idleTimeoutMillis: 30_000,${p.ssl ? "\n  ssl: { rejectUnauthorized: true },  // set ca: fs.readFileSync(...) for a private CA" : ""}\n});\n\nconst { rows } = await pool.query("SELECT now()");\nconsole.log(rows[0]);\n`;
            out["Prisma"] = `datasource db {\n  provider  = "postgresql"\n  url       = env("${env}")\n  // directUrl = env("DIRECT_URL") // when ${env} goes through a pooler\n}\n`;
            out["CLI"] = `psql "${redacted}"`;
            break;
        case "mysql":
            out["mysql2"] = `import mysql from "mysql2/promise";\n\nexport const pool = mysql.createPool({\n  uri: process.env.${env},\n  connectionLimit: 10,\n  waitForConnections: true,${p.ssl ? '\n  ssl: { rejectUnauthorized: true },' : ""}\n});\n\nconst [rows] = await pool.query("SELECT NOW() AS now");\nconsole.log(rows);\n`;
            out["Prisma"] = `datasource db {\n  provider = "mysql"\n  url      = env("${env}")\n}\n`;
            out["CLI"] = `mysql -h ${p.host} -P ${p.port ?? 3306} -u ${p.user} -p ${p.database}${p.ssl ? " --ssl-mode=REQUIRED" : ""}`;
            break;
        case "mongodb":
        case "mongodb+srv":
            out["Mongoose"] = `import mongoose from "mongoose";\n\nexport async function connectDb() {\n  // Reuse the connection across hot reloads and serverless invocations.\n  if (mongoose.connection.readyState === 1) return mongoose;\n  return mongoose.connect(process.env.${env} as string, {\n    serverSelectionTimeoutMS: 5000,\n    maxPoolSize: 10,\n  });\n}\n`;
            out["MongoDB driver"] = `import { MongoClient } from "mongodb";\n\nconst client = new MongoClient(process.env.${env} as string);\nawait client.connect();\nconst db = client.db(${JSON.stringify(p.database || "app")});\nconsole.log(await db.command({ ping: 1 }));\n`;
            out["Prisma"] = `datasource db {\n  provider = "mongodb"\n  url      = env("${env}")\n}\n`;
            out["CLI"] = `mongosh "${redacted}"`;
            break;
        case "redis":
            out["ioredis"] = `import Redis from "ioredis";\n\nexport const redis = new Redis(process.env.${env} as string, {\n  maxRetriesPerRequest: 3,\n  // Upstash / ElastiCache with TLS use rediss:// URLs.\n});\n\nawait redis.set("health", "ok", "EX", 60);\nconsole.log(await redis.get("health"));\n`;
            out["node-redis"] = `import { createClient } from "redis";\n\nexport const redis = createClient({ url: process.env.${env} });\nredis.on("error", err => console.error("Redis error", err));\nawait redis.connect();\n`;
            out["CLI"] = `redis-cli -u "${redacted}"${p.ssl ? " --tls" : ""}`;
            break;
        case "sqlserver":
            out["mssql"] = `import sql from "mssql";\n\nexport const pool = await sql.connect({\n  server: ${JSON.stringify(p.host)},\n  port: ${p.port ?? 1433},\n  database: ${JSON.stringify(p.database)},\n  user: process.env.DB_USER,\n  password: process.env.DB_PASSWORD,\n  options: { encrypt: ${p.ssl}, trustServerCertificate: ${!p.ssl} },\n});\n`;
            out["Prisma"] = `datasource db {\n  provider = "sqlserver"\n  url      = env("${env}")\n}\n`;
            out["CLI"] = `sqlcmd -S ${p.host},${p.port ?? 1433} -d ${p.database} -U ${p.user} -P '********'`;
            break;
    }
    return out;
}
exports.connectionSnippets = connectionSnippets;
function sqlLiteral(token) {
    const t = token.trim();
    if (/^'.*'$/s.test(t))
        return t.slice(1, -1).replace(/''/g, "'");
    if (/^".*"$/s.test(t))
        return t.slice(1, -1);
    if (/^-?\d+(\.\d+)?$/.test(t))
        return Number(t);
    if (/^true$/i.test(t))
        return true;
    if (/^false$/i.test(t))
        return false;
    if (/^null$/i.test(t))
        return null;
    if (/^(now\(\)|current_timestamp)$/i.test(t))
        return { $date: "now" };
    return { $field: t };
}
function splitTop(text, sep) {
    const parts = [];
    let depth = 0;
    let quote = "";
    let last = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === quote)
                quote = "";
            continue;
        }
        if (c === "'" || c === '"') {
            quote = c;
            continue;
        }
        if (c === "(")
            depth++;
        if (c === ")")
            depth--;
        if (depth === 0) {
            sep.lastIndex = i;
            const m = sep.exec(text);
            if (m && m.index === i) {
                parts.push(text.slice(last, i));
                last = i + m[0].length;
                i = last - 1;
            }
        }
    }
    parts.push(text.slice(last));
    return parts.map(p => p.trim()).filter(Boolean);
}
const fieldName = (s) => s.trim().replace(/^[`"[]|[`"\]]$/g, "").replace(/^\w+\./, "");
function likeToRegex(pattern) {
    let re = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
    re = re.startsWith(".*") ? re.slice(2) : `^${re}`;
    re = re.endsWith(".*") ? re.slice(0, -2) : `${re}$`;
    return re;
}
function whereToMongo(expr) {
    let e = expr.trim();
    while (e.startsWith("(") && e.endsWith(")") && balanced(e.slice(1, -1)))
        e = e.slice(1, -1).trim();
    const ors = splitTop(e, /\s+or\s+/gi);
    if (ors.length > 1)
        return { $or: ors.map(whereToMongo) };
    const ands = splitTopAnd(e);
    if (ands.length > 1) {
        const parts = ands.map(whereToMongo);
        const merged = {};
        for (const p of parts)
            for (const [k, v] of Object.entries(p)) {
                if (k in merged && typeof merged[k] === "object" && typeof v === "object" && merged[k] && v && !Array.isArray(v))
                    merged[k] = { ...merged[k], ...v };
                else if (k in merged)
                    return { $and: parts };
                else
                    merged[k] = v;
            }
        return merged;
    }
    let m;
    if ((m = /^not\s+(.+)$/is.exec(e)))
        return { $nor: [whereToMongo(m[1])] };
    if ((m = /^(\S+)\s+is\s+not\s+null$/i.exec(e)))
        return { [fieldName(m[1])]: { $ne: null } };
    if ((m = /^(\S+)\s+is\s+null$/i.exec(e)))
        return { [fieldName(m[1])]: null };
    if ((m = /^(\S+)\s+(not\s+)?between\s+(.+?)\s+and\s+(.+)$/is.exec(e))) {
        const r = { $gte: sqlLiteral(m[3]), $lte: sqlLiteral(m[4]) };
        return { [fieldName(m[1])]: m[2] ? { $not: r } : r };
    }
    if ((m = /^(\S+)\s+(not\s+)?in\s*\((.*)\)$/is.exec(e)))
        return { [fieldName(m[1])]: { [m[2] ? "$nin" : "$in"]: splitTop(m[3], /,/g).map(sqlLiteral) } };
    if ((m = /^(\S+)\s+(not\s+)?(i?like)\s+'(.*)'$/is.exec(e))) {
        const r = { $regex: likeToRegex(m[4]), ...(m[3].toLowerCase() === "ilike" ? { $options: "i" } : {}) };
        return { [fieldName(m[1])]: m[2] ? { $not: r } : r };
    }
    if ((m = /^(.+?)\s*(<>|!=|>=|<=|=|>|<)\s*(.+)$/s.exec(e))) {
        const op = { "=": "$eq", "<>": "$ne", "!=": "$ne", ">": "$gt", ">=": "$gte", "<": "$lt", "<=": "$lte" }[m[2]];
        const value = sqlLiteral(m[3]);
        if (value && typeof value === "object" && "$field" in value)
            return { $expr: { [op]: [`$${fieldName(m[1])}`, `$${fieldName(value.$field)}`] } };
        return { [fieldName(m[1])]: op === "$eq" ? value : { [op]: value } };
    }
    throw new types_1.ToolInputError(`Cannot convert the condition "${e}".`);
}
function balanced(s) {
    let d = 0;
    for (const c of s) {
        if (c === "(")
            d++;
        if (c === ")")
            d--;
        if (d < 0)
            return false;
    }
    return d === 0;
}
/** AND splits that skip the AND inside BETWEEN x AND y. */
function splitTopAnd(e) {
    const raw = splitTop(e, /\s+and\s+/gi);
    const out = [];
    for (const part of raw) {
        if (out.length && /\sbetween\s+\S+$/i.test(out[out.length - 1]))
            out[out.length - 1] += ` AND ${part}`;
        else
            out.push(part);
    }
    return out;
}
/** JS object literal: short objects and arrays stay on one line. */
function compactJs(value, indent = 0) {
    const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
    const flat = (v) => Array.isArray(v) ? `[${v.map(flat).join(", ")}]` : v && typeof v === "object" ? (Object.keys(v).length ? `{ ${Object.entries(v).map(([k, x]) => `${key(k)}: ${flat(x)}`).join(", ")} }` : "{}") : JSON.stringify(v);
    const one = flat(value);
    if (one.length + indent * 2 <= 72 || !value || typeof value !== "object")
        return one;
    const pad = "  ".repeat(indent + 1);
    const end = "  ".repeat(indent);
    if (Array.isArray(value))
        return `[\n${value.map(v => pad + compactJs(v, indent + 1)).join(",\n")}\n${end}]`;
    return `{\n${Object.entries(value).map(([k, v]) => `${pad}${key(k)}: ${compactJs(v, indent + 1)}`).join(",\n")}\n${end}}`;
}
exports.compactJs = compactJs;
function sqlToMongo(sql) {
    const q = sql.trim().replace(/;$/, "").replace(/\s+/g, " ");
    const m = /^select\s+(distinct\s+)?(.+?)\s+from\s+([`"\w.]+)(?:\s+(?:as\s+)?\w+)?(?:\s+where\s+(.+?))?(?:\s+group\s+by\s+(.+?))?(?:\s+having\s+(.+?))?(?:\s+order\s+by\s+(.+?))?(?:\s+limit\s+(\d+)(?:\s*,\s*(\d+))?)?(?:\s+offset\s+(\d+))?$/i.exec(q);
    if (!m) {
        if (/\bjoin\b/i.test(q))
            throw new types_1.ToolInputError("JOINs map to $lookup stages and usually mean the schema should embed the data; this converter handles single-collection SELECTs.");
        throw new types_1.ToolInputError("Supported: SELECT [DISTINCT] cols FROM table [WHERE ...] [GROUP BY ...] [HAVING ...] [ORDER BY ...] [LIMIT n] [OFFSET n].");
    }
    const [, distinct, colsRaw, tableRaw, where, groupBy, having, orderBy, limitA, limitB, offset] = m;
    const collection = fieldName(tableRaw.split(".").pop());
    const filter = where ? whereToMongo(where) : {};
    const cols = splitTop(colsRaw, /,/g);
    const sort = {};
    for (const part of orderBy ? splitTop(orderBy, /,/g) : []) {
        const [f, dir] = part.split(/\s+/);
        sort[fieldName(f)] = /desc/i.test(dir ?? "") ? -1 : 1;
    }
    const limit = limitB ? Number(limitB) : limitA ? Number(limitA) : undefined;
    const skip = limitB ? Number(limitA) : offset ? Number(offset) : undefined;
    const aggCol = (c) => /^(count|sum|avg|min|max)\s*\(/i.test(c);
    const fmt = (v) => compactJs(v).replace(/\{ ?\$date: "now" ?\}/g, "new Date()");
    if (groupBy || cols.some(aggCol) || distinct) {
        const groupFields = groupBy ? splitTop(groupBy, /,/g).map(fieldName) : distinct ? cols.map(c => fieldName(c)) : [];
        const id = groupFields.length === 0 ? null : groupFields.length === 1 ? `$${groupFields[0]}` : Object.fromEntries(groupFields.map(f => [f, `$${f}`]));
        const group = { _id: id };
        const project = { _id: 0 };
        if (groupFields.length === 1)
            project[groupFields[0]] = "$_id";
        else
            for (const f of groupFields)
                project[f] = `$_id.${f}`;
        for (const c of cols) {
            const a = /^(count|sum|avg|min|max)\s*\(\s*(distinct\s+)?([^)]*)\)\s*(?:as\s+)?(\w+)?$/i.exec(c);
            if (!a)
                continue;
            const fn = a[1].toLowerCase();
            const alias = a[4] ?? `${fn}${a[3] === "*" ? "" : "_" + fieldName(a[3])}`;
            if (fn === "count" && a[2]) {
                group[alias] = { $addToSet: `$${fieldName(a[3])}` };
                project[alias] = { $size: `$${alias}` };
                continue;
            }
            group[alias] = fn === "count" ? { $sum: a[3].trim() === "*" ? 1 : { $cond: [{ $ne: [`$${fieldName(a[3])}`, null] }, 1, 0] } } : { [`$${fn}`]: `$${fieldName(a[3])}` };
            project[alias] = 1;
        }
        const pipeline = [];
        if (where)
            pipeline.push({ $match: filter });
        pipeline.push({ $group: group });
        if (having) {
            const h = having.replace(/(count|sum|avg|min|max)\s*\(\s*([^)]*)\)/gi, (_, fn, arg) => { const c = cols.find(col => new RegExp(`^${fn}\\s*\\(\\s*${arg.replace(/[*]/g, "\\*")}\\s*\\)`, "i").test(col)); const am = c ? /(?:as\s+)?(\w+)$/i.exec(c) : null; return am && c !== am[1] ? am[1] : `${fn.toLowerCase()}${arg.trim() === "*" ? "" : "_" + fieldName(arg)}`; });
            pipeline.push({ $match: whereToMongo(h) });
        }
        pipeline.push({ $project: project });
        if (Object.keys(sort).length)
            pipeline.push({ $sort: sort });
        if (skip)
            pipeline.push({ $skip: skip });
        if (limit !== undefined)
            pipeline.push({ $limit: limit });
        const p = fmt(pipeline);
        return { collection, aggregate: true, shell: `db.${collection}.aggregate(${p})`, node: `const results = await db.collection(${JSON.stringify(collection)}).aggregate(${p}).toArray();`, mongoose: `const results = await ${(0, scaffold_names_1.pascalOf)(collection.replace(/s$/, ""))}.aggregate(${p});` };
    }
    const projection = {};
    if (!(cols.length === 1 && cols[0] === "*")) {
        for (const c of cols)
            projection[fieldName(c.split(/\s+as\s+/i)[0])] = 1;
        if (!("_id" in projection) && !("id" in projection))
            projection._id = 0;
    }
    const hasProj = Object.keys(projection).length > 0;
    const chain = `${Object.keys(sort).length ? `.sort(${fmt(sort)})` : ""}${skip ? `.skip(${skip})` : ""}${limit !== undefined ? `.limit(${limit})` : ""}`;
    const shell = `db.${collection}.find(${fmt(filter)}${hasProj ? `, ${fmt(projection)}` : ""})${chain}`;
    return {
        collection,
        aggregate: false,
        shell,
        node: `const results = await db.collection(${JSON.stringify(collection)}).find(${fmt(filter)}${hasProj ? `, { projection: ${fmt(projection)} }` : ""})${chain}.toArray();`,
        mongoose: `const results = await ${(0, scaffold_names_1.pascalOf)(collection.replace(/s$/, ""))}.find(${fmt(filter)}${hasProj ? `, ${fmt(projection)}` : ""})${chain}.lean();`
    };
}
exports.sqlToMongo = sqlToMongo;
//# sourceMappingURL=web-scaffold.js.map