"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.diffSchemas = exports.schemaTree = exports.normalizeSchema = exports.analyzeDeltaLog = exports.sizeCluster = exports.partitionCode = exports.planPartitions = void 0;
const types_1 = require("../types");
const data_types_1 = require("./data-types");
const MB = 1024 * 1024;
const GB = 1024 * MB;
function planPartitions(p) {
    if (p.totalGB <= 0)
        throw new types_1.ToolInputError("Data size must be greater than 0.");
    const onDiskBytes = (p.totalGB * GB) / Math.max(1, p.compressionRatio);
    const perPartitionBytes = onDiskBytes / Math.max(1, p.partitionCount);
    const filesPerPartition = Math.max(1, Math.round(perPartitionBytes / (p.targetFileMB * MB)));
    const totalFiles = filesPerPartition * Math.max(1, p.partitionCount);
    // Shuffle partitions: ~128-200 MB of uncompressed shuffle data each, at least 2 waves of cores.
    const shufflePartitions = Math.max(p.executorCores * 2, Math.ceil((p.totalGB * GB) / (160 * MB)));
    const warnings = [];
    if (perPartitionBytes < 32 * MB && p.partitionCount > 1)
        warnings.push(`Each table partition holds only ~${(perPartitionBytes / MB).toFixed(1)} MB. Too many small partitions slow listing and planning: partition by a coarser column (e.g. month instead of day) or not at all.`);
    if (p.partitionCount > 10000)
        warnings.push(`${p.partitionCount.toLocaleString()} partitions is a lot for the metastore; prefer clustering / Z-ORDER / liquid clustering for high-cardinality columns.`);
    if (p.targetFileMB < 64)
        warnings.push("Target files under 64 MB lead to the small-files problem; 128 MB - 1 GB is typical for Parquet/Delta.");
    return { onDiskBytes, perPartitionBytes, filesPerPartition, totalFiles, shufflePartitions, warnings };
}
exports.planPartitions = planPartitions;
function partitionCode(p, partitionColumn, shufflePartitions, filesPerPartition) {
    const col = partitionColumn.trim() || "event_date";
    const partitions = Math.max(1, p.partitionCount);
    const write = filesPerPartition > 1
        ? `# ~${filesPerPartition} files of ~${p.targetFileMB} MB per "${col}" value: salt the shuffle so each value is spread over several tasks.
df = df.repartition(${partitions * filesPerPartition}, "${col}", (F.rand(seed=42) * ${filesPerPartition}).cast("int"))`
        : `# One file per "${col}" value (each partition is ~${Math.max(1, Math.round(p.targetFileMB))} MB or less).
df = df.repartition("${col}")`;
    return `from pyspark.sql import functions as F

spark.conf.set("spark.sql.adaptive.enabled", "true")
spark.conf.set("spark.sql.adaptive.coalescePartitions.enabled", "true")
spark.conf.set("spark.sql.shuffle.partitions", "${shufflePartitions}")
spark.conf.set("spark.sql.files.maxPartitionBytes", str(${p.targetFileMB} * 1024 * 1024))

${write}
(
    df.write.mode("overwrite")
    .partitionBy("${col}")
    .format("delta")  # or "parquet"
    .save("s3://bucket/path/table")
)
`;
}
exports.partitionCode = partitionCode;
function sizeCluster(c) {
    // Usable executor memory per node after OS/overhead (~75%).
    const usablePerNode = c.nodeMemoryGB * 0.75;
    const workers = Math.max(2, Math.ceil((c.dataGBPerRun * c.memoryFactor) / usablePerNode));
    const nodes = workers + 1; // + driver
    const hourly = nodes * c.nodeHourlyUsd * (1 + c.platformUpliftPct / 100);
    const hoursPerDay = (c.runsPerDay * c.runtimeMinutes) / 60;
    const daily = hourly * hoursPerDay;
    const executorsPerNode = Math.max(1, Math.floor((c.nodeCores - 1) / 5));
    const coresPerExecutor = Math.max(1, Math.floor((c.nodeCores - 1) / executorsPerNode));
    const executorMemoryGB = Math.max(1, Math.floor((usablePerNode / executorsPerNode) * 0.9));
    return { workers, nodes, hourly, daily, monthly: daily * 30, hoursPerDay, executorsPerNode, coresPerExecutor, executorMemoryGB, totalCores: workers * c.nodeCores };
}
exports.sizeCluster = sizeCluster;
// ---------------------------------------------------------------------------
// Delta Lake transaction log
// ---------------------------------------------------------------------------
function analyzeDeltaLog(text, smallFileMB) {
    if (!text.trim())
        throw new types_1.ToolInputError("Paste one or more _delta_log/*.json commit files.");
    const operations = new Map();
    let commits = 0, adds = 0, removes = 0, addBytes = 0, removeBytes = 0, smallFiles = 0, badLines = 0;
    const schemaChanges = [];
    let protocol;
    let engine;
    const partitionColumns = new Set();
    let firstTs;
    let lastTs;
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        let action;
        try {
            action = JSON.parse(line);
        }
        catch {
            badLines++;
            continue;
        }
        if (action.commitInfo) {
            commits++;
            const op = action.commitInfo.operation ?? "UNKNOWN";
            operations.set(op, (operations.get(op) ?? 0) + 1);
            engine = action.commitInfo.engineInfo ?? engine;
            const ts = Number(action.commitInfo.timestamp);
            if (Number.isFinite(ts)) {
                firstTs = firstTs === undefined ? ts : Math.min(firstTs, ts);
                lastTs = lastTs === undefined ? ts : Math.max(lastTs, ts);
            }
        }
        if (action.add) {
            adds++;
            const size = Number(action.add.size) || 0;
            addBytes += size;
            if (size && size < smallFileMB * MB)
                smallFiles++;
        }
        if (action.remove) {
            removes++;
            removeBytes += Number(action.remove.size) || 0;
        }
        if (action.metaData) {
            schemaChanges.push(action.metaData.schemaString ? `schema set (${(JSON.parse(action.metaData.schemaString).fields ?? []).length} fields)` : "metadata updated");
            for (const c of action.metaData.partitionColumns ?? [])
                partitionColumns.add(c);
        }
        if (action.protocol)
            protocol = `reader v${action.protocol.minReaderVersion}, writer v${action.protocol.minWriterVersion}${action.protocol.writerFeatures ? ` (${action.protocol.writerFeatures.join(", ")})` : ""}`;
    }
    const recommendations = [];
    if (adds && smallFiles / adds > 0.3)
        recommendations.push(`${smallFiles} of ${adds} added files are under ${smallFileMB} MB: run OPTIMIZE (or enable optimized writes / auto compaction).`);
    if (removes > adds * 2 && removes > 50)
        recommendations.push("Many files were removed: VACUUM (default 7-day retention) reclaims their storage once no reader needs time travel to them.");
    if ((operations.get("WRITE") ?? 0) + (operations.get("STREAMING UPDATE") ?? 0) > 100)
        recommendations.push("Frequent small writes: consider larger micro-batches or a checkpoint-friendly trigger interval.");
    if (badLines)
        recommendations.push(`${badLines} line(s) were not valid JSON and were skipped.`);
    return { commits, operations: [...operations.entries()].sort((a, b) => b[1] - a[1]), adds, removes, addBytes, removeBytes, smallFiles, schemaChanges, protocol, engine, partitionColumns: [...partitionColumns], firstTs, lastTs, recommendations };
}
exports.analyzeDeltaLog = analyzeDeltaLog;
function fromShape(shape, path, out, nullable = false) {
    switch (shape.kind) {
        case "object":
            for (const [key, f] of shape.fields)
                fromShape(f.shape, path ? `${path}.${key}` : key, out, f.count < shape.samples);
            return;
        case "array": {
            const itemType = shape.item.kind === "object" ? "struct" : shape.item.kind;
            out.push({ path, type: `array<${itemType}>`, nullable });
            if (shape.item.kind === "object")
                fromShape(shape.item, `${path}[]`, out);
            return;
        }
        case "union": {
            const rest = shape.options.filter(o => o.kind !== "null");
            if (rest.length === 1)
                fromShape(rest[0], path, out, true);
            else
                out.push({ path, type: rest.map(r => r.kind).join("|"), nullable: rest.length < shape.options.length || nullable });
            return;
        }
        default:
            out.push({ path, type: shape.kind === "integer" ? "long" : shape.kind === "number" ? "double" : shape.kind, nullable: nullable || shape.kind === "null" });
    }
}
function fromJsonSchema(schema, path, out, nullable) {
    const types = Array.isArray(schema?.type) ? schema.type : schema?.type ? [schema.type] : [];
    const isNullable = nullable || types.includes("null");
    const main = types.filter(t => t !== "null")[0] ?? (schema?.properties ? "object" : schema?.items ? "array" : "any");
    if (main === "object") {
        const required = new Set(schema.required ?? []);
        if (path)
            out.push({ path, type: "struct", nullable: isNullable });
        for (const [key, child] of Object.entries(schema.properties ?? {}))
            fromJsonSchema(child, path ? `${path}.${key}` : key, out, !required.has(key));
    }
    else if (main === "array") {
        const item = schema.items ?? {};
        const itemType = Array.isArray(item.type) ? item.type.find((t) => t !== "null") : item.type;
        out.push({ path, type: `array<${itemType === "object" ? "struct" : itemType ?? "any"}>`, nullable: isNullable });
        if (itemType === "object")
            fromJsonSchema(item, `${path}[]`, out, false);
    }
    else {
        out.push({ path, type: schema.format ? `${main}(${schema.format})` : main, nullable: isNullable });
    }
}
function avroType(t) {
    if (Array.isArray(t)) {
        const rest = t.filter(x => x !== "null");
        const inner = avroType(rest.length === 1 ? rest[0] : rest);
        return { ...inner, nullable: rest.length < t.length || inner.nullable };
    }
    if (typeof t === "string")
        return { type: t, nullable: false };
    if (t?.type === "record")
        return { type: "struct", nullable: false, record: t };
    if (t?.type === "array")
        return { type: `array<${typeof t.items === "string" ? t.items : t.items?.type === "record" ? "struct" : t.items?.type}>`, nullable: false, items: t.items };
    if (t?.logicalType)
        return { type: `${t.type}(${t.logicalType})`, nullable: false };
    if (t?.type === "enum")
        return { type: `enum(${(t.symbols ?? []).join("|")})`, nullable: false };
    if (t?.type === "map")
        return { type: `map<string,${typeof t.values === "string" ? t.values : "complex"}>`, nullable: false };
    return { type: String(t?.type ?? "unknown"), nullable: false };
}
function fromAvro(record, path, out) {
    for (const field of record.fields ?? []) {
        const p = path ? `${path}.${field.name}` : field.name;
        const t = avroType(field.type);
        out.push({ path: p, type: t.type, nullable: t.nullable });
        if (t.record)
            fromAvro(t.record, p, out);
        if (t.items?.type === "record")
            fromAvro(t.items, `${p}[]`, out);
    }
}
function sparkType(t) {
    if (typeof t === "string")
        return t;
    if (t?.type === "struct")
        return "struct";
    if (t?.type === "array")
        return `array<${sparkType(t.elementType)}>`;
    if (t?.type === "map")
        return `map<${sparkType(t.keyType)},${sparkType(t.valueType)}>`;
    return String(t?.type ?? "unknown");
}
function fromSpark(struct, path, out) {
    for (const field of struct.fields ?? []) {
        const p = path ? `${path}.${field.name}` : field.name;
        out.push({ path: p, type: sparkType(field.type), nullable: field.nullable !== false });
        if (field.type?.type === "struct")
            fromSpark(field.type, p, out);
        if (field.type?.type === "array" && field.type.elementType?.type === "struct")
            fromSpark(field.type.elementType, `${p}[]`, out);
    }
}
function normalizeSchema(input) {
    let value;
    try {
        value = JSON.parse(input);
    }
    catch {
        throw new types_1.ToolInputError("The schema must be JSON (JSON Schema, Avro .avsc, Spark StructType JSON, or a sample JSON document).");
    }
    const fields = [];
    if (value && value.type === "record" && Array.isArray(value.fields)) {
        fromAvro(value, "", fields);
        return { format: "Avro", fields };
    }
    if (value && value.type === "struct" && Array.isArray(value.fields)) {
        fromSpark(value, "", fields);
        return { format: "Spark StructType", fields };
    }
    if (value && (value.$schema || (value.type === "object" && value.properties))) {
        fromJsonSchema(value, "", fields, false);
        return { format: "JSON Schema", fields };
    }
    fromShape((0, data_types_1.recordShape)(value), "", fields);
    return { format: "sample JSON (inferred)", fields };
}
exports.normalizeSchema = normalizeSchema;
function schemaTree(fields) {
    return fields.map(f => {
        const depth = (f.path.match(/\./g) || []).length;
        const name = f.path.split(".").pop();
        return `${"  ".repeat(depth)}${depth ? "└─ " : ""}${name}: ${f.type}${f.nullable ? " (nullable)" : ""}`;
    }).join("\n");
}
exports.schemaTree = schemaTree;
const WIDENING = { int: ["long", "float", "double"], integer: ["long", "number", "double"], long: ["double"], float: ["double"], number: [] };
function diffSchemas(before, after) {
    const a = new Map(before.map(f => [f.path, f]));
    const b = new Map(after.map(f => [f.path, f]));
    const changes = [];
    for (const [path, f] of a) {
        const g = b.get(path);
        if (!g) {
            changes.push({ path, change: `removed (${f.type})`, breaking: true });
            continue;
        }
        if (f.type !== g.type) {
            const widening = WIDENING[f.type]?.includes(g.type);
            changes.push({ path, change: `type ${f.type} → ${g.type}${widening ? " (widening)" : ""}`, breaking: !widening });
        }
        if (f.nullable && !g.nullable)
            changes.push({ path, change: "nullable → required", breaking: true });
        if (!f.nullable && g.nullable)
            changes.push({ path, change: "required → nullable", breaking: false });
    }
    for (const [path, g] of b)
        if (!a.has(path))
            changes.push({ path, change: `added (${g.type}${g.nullable ? ", nullable" : ", required"})`, breaking: !g.nullable });
    return changes;
}
exports.diffSchemas = diffSchemas;
//# sourceMappingURL=bigdata.js.map