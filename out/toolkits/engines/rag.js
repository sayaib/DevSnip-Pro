"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateChunkRecords = exports.parseFieldRules = exports.findNearDuplicates = exports.jaccard = exports.reciprocalRankFusion = exports.checkGrounding = exports.evaluateRetrieval = exports.parseEvalCases = exports.contextBudget = exports.planIngestion = exports.chunksToJsonl = exports.chunkStats = exports.chunkText = exports.splitSentences = void 0;
const types_1 = require("../types");
const models_1 = require("./models");
const RECURSIVE_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""];
function measure(text, unit) {
    return unit === "tokens" ? (0, models_1.estimateTokens)(text) : text.length;
}
/** Splits text into pieces no larger than `size`, trying coarse separators first (like LangChain's recursive splitter). */
function splitRecursive(text, size, unit, separators = RECURSIVE_SEPARATORS) {
    if (measure(text, unit) <= size)
        return [text];
    const [separator, ...rest] = separators;
    if (separator === undefined)
        return [text];
    if (separator === "") {
        // Last resort: hard cut.
        const out = [];
        const step = unit === "tokens" ? size * 4 : size;
        for (let i = 0; i < text.length; i += step)
            out.push(text.slice(i, i + step));
        return out;
    }
    const parts = text.split(separator);
    if (parts.length === 1)
        return splitRecursive(text, size, unit, rest);
    const pieces = [];
    parts.forEach((part, index) => {
        const piece = index < parts.length - 1 ? part + separator : part;
        if (!piece)
            return;
        if (measure(piece, unit) > size)
            pieces.push(...splitRecursive(piece, size, unit, rest));
        else
            pieces.push(piece);
    });
    return pieces;
}
/** Packs pieces into chunks of at most `size`, carrying `overlap` worth of trailing pieces forward. */
function pack(pieces, size, overlap, unit) {
    const chunks = [];
    let current = [];
    let currentSize = 0;
    for (const piece of pieces) {
        const pieceSize = measure(piece, unit);
        if (currentSize + pieceSize > size && current.length) {
            chunks.push(current.join(""));
            // Keep a tail of the previous chunk as overlap.
            const tail = [];
            let tailSize = 0;
            for (let i = current.length - 1; i >= 0; i--) {
                const s = measure(current[i], unit);
                if (tailSize + s > overlap)
                    break;
                tail.unshift(current[i]);
                tailSize += s;
            }
            current = tail;
            currentSize = tailSize;
        }
        current.push(piece);
        currentSize += pieceSize;
    }
    if (current.length)
        chunks.push(current.join(""));
    return chunks;
}
function splitSentences(text) {
    // Keep abbreviations like "e.g." and decimals together.
    const protectedText = text.replace(/\b(e\.g|i\.e|etc|vs|Mr|Mrs|Dr|Inc|No)\./g, "$1\u0000").replace(/(\d)\.(\d)/g, "$1\u0001$2");
    const sentences = protectedText.match(/[^.!?\n]+(?:[.!?]+["')\]]*\s*|\n+|$)/g) || [];
    return sentences.map(s => s.replace(/\u0000/g, ".").replace(/\u0001/g, ".")).filter(s => s.trim());
}
exports.splitSentences = splitSentences;
function markdownSections(text) {
    const sections = [];
    const trail = [];
    let body = [];
    let inFence = false;
    const flush = () => {
        const content = body.join("\n").trim();
        if (content)
            sections.push({ headings: trail.filter(Boolean).join(" > "), body: content });
        body = [];
    };
    for (const line of text.split("\n")) {
        if (/^\s*(```|~~~)/.test(line))
            inFence = !inFence;
        const heading = !inFence ? /^(#{1,6})\s+(.*)$/.exec(line) : null;
        if (heading) {
            flush();
            const level = heading[1].length;
            trail.length = level - 1;
            trail[level - 1] = heading[2].trim();
            body.push(line);
        }
        else {
            body.push(line);
        }
    }
    flush();
    return sections;
}
function chunkText(text, o) {
    if (!text.trim())
        throw new types_1.ToolInputError("Paste or load a document to chunk.");
    if (o.size <= 0)
        throw new types_1.ToolInputError("Chunk size must be greater than 0.");
    if (o.overlap < 0 || o.overlap >= o.size)
        throw new types_1.ToolInputError("Overlap must be at least 0 and smaller than the chunk size.");
    const normalized = text.replace(/\r\n/g, "\n");
    let raw = [];
    switch (o.strategy) {
        case "fixed": {
            const size = o.unit === "tokens" ? o.size * 4 : o.size;
            const step = o.unit === "tokens" ? (o.size - o.overlap) * 4 : o.size - o.overlap;
            for (let start = 0; start < normalized.length; start += step) {
                raw.push({ text: normalized.slice(start, start + size) });
                if (start + size >= normalized.length)
                    break;
            }
            break;
        }
        case "sentence":
            raw = pack(splitSentences(normalized).flatMap(s => splitRecursive(s, o.size, o.unit)), o.size, o.overlap, o.unit).map(t => ({ text: t }));
            break;
        case "markdown":
            for (const section of markdownSections(normalized)) {
                for (const t of pack(splitRecursive(section.body, o.size, o.unit), o.size, o.overlap, o.unit))
                    raw.push({ text: t, headings: section.headings || undefined });
            }
            break;
        default:
            raw = pack(splitRecursive(normalized, o.size, o.unit), o.size, o.overlap, o.unit).map(t => ({ text: t }));
    }
    return raw
        .map(r => ({ ...r, text: r.text.trim() }))
        .filter(r => r.text)
        .map((r, index) => ({ index, text: r.text, chars: r.text.length, tokens: (0, models_1.estimateTokens)(r.text), headings: r.headings }));
}
exports.chunkText = chunkText;
function chunkStats(chunks, o) {
    const tokens = chunks.map(c => c.tokens);
    const target = o.unit === "tokens" ? o.size : o.size / 4;
    const seen = new Set();
    let duplicateChunks = 0;
    for (const c of chunks) {
        const key = c.text.toLowerCase().replace(/\s+/g, " ");
        if (seen.has(key))
            duplicateChunks++;
        seen.add(key);
    }
    return {
        count: chunks.length,
        minTokens: tokens.length ? Math.min(...tokens) : 0,
        avgTokens: tokens.length ? Math.round(tokens.reduce((a, b) => a + b, 0) / tokens.length) : 0,
        maxTokens: tokens.length ? Math.max(...tokens) : 0,
        tinyChunks: chunks.filter(c => c.tokens < target * 0.2).length,
        duplicateChunks,
        totalTokens: tokens.reduce((a, b) => a + b, 0)
    };
}
exports.chunkStats = chunkStats;
function chunksToJsonl(chunks, source) {
    return chunks.map(c => JSON.stringify({
        id: `${source.replace(/[^\w.-]+/g, "_")}#${c.index}`,
        text: c.text,
        metadata: { source, chunk_index: c.index, ...(c.headings ? { headings: c.headings } : {}), tokens: c.tokens }
    })).join("\n") + "\n";
}
exports.chunksToJsonl = chunksToJsonl;
function planIngestion(i) {
    if (i.overlapTokens >= i.chunkTokens)
        throw new types_1.ToolInputError("Overlap must be smaller than the chunk size.");
    const stride = i.chunkTokens - i.overlapTokens;
    const chunksPerDoc = i.avgDocTokens <= i.chunkTokens ? 1 : 1 + Math.ceil((i.avgDocTokens - i.chunkTokens) / stride);
    const totalChunks = chunksPerDoc * i.documents;
    // Each chunk embeds its own tokens, overlap included.
    const embeddingTokens = totalChunks * Math.min(i.chunkTokens, i.avgDocTokens);
    const vectorBytes = totalChunks * i.dimensions * i.vectorBytes;
    // HNSW graph: ~2*M neighbour ids (4 bytes) per vector at layer 0, plus upper layers (~+10%).
    const indexBytes = totalChunks * i.hnswM * 2 * 4 * 1.1;
    // Stored chunk text (~4 bytes per token) plus ~200 bytes of metadata.
    const textBytes = totalChunks * (Math.min(i.chunkTokens, i.avgDocTokens) * 4 + 200);
    const price = i.pricePerMillion;
    const oneTimeCost = price !== undefined ? (embeddingTokens / 1e6) * price : undefined;
    const monthlyCost = price !== undefined
        ? ((i.queriesPerMonth * i.avgQueryTokens + embeddingTokens * i.reembedPerMonth / 100) / 1e6) * price
        : undefined;
    return {
        chunksPerDoc, totalChunks, embeddingTokens, oneTimeCost, monthlyCost,
        vectorBytes, indexBytes, textBytes, totalBytes: vectorBytes + indexBytes + textBytes,
        ramForIndexBytes: vectorBytes + indexBytes
    };
}
exports.planIngestion = planIngestion;
function contextBudget(b) {
    const fixed = b.systemTokens + b.historyTokens + b.questionTokens + b.outputTokens;
    const usable = Math.floor(b.contextWindow * (1 - b.safetyMargin / 100));
    const retrieved = b.chunkTokens * b.topK;
    const used = fixed + retrieved;
    const maxK = b.chunkTokens > 0 ? Math.max(0, Math.floor((usable - fixed) / b.chunkTokens)) : 0;
    return { fixed, usable, retrieved, used, remaining: usable - used, maxK, utilisation: used / b.contextWindow };
}
exports.contextBudget = contextBudget;
function parseEvalCases(text) {
    const cases = [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    if (!lines.length)
        throw new types_1.ToolInputError("Add at least one query.");
    const ids = (value, line, field) => {
        if (Array.isArray(value))
            return value.map(String);
        if (typeof value === "string")
            return value.split(/[,\s]+/).filter(Boolean);
        throw new types_1.ToolInputError(`Line ${line}: "${field}" must be a list of document ids.`);
    };
    lines.forEach((line, index) => {
        if (line.startsWith("{")) {
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                throw new types_1.ToolInputError(`Line ${index + 1} is not valid JSON.`);
            }
            cases.push({ query: String(parsed.query ?? `query ${index + 1}`), relevant: ids(parsed.relevant, index + 1, "relevant"), retrieved: ids(parsed.retrieved, index + 1, "retrieved") });
        }
        else {
            const parts = line.split("|").map(p => p.trim());
            if (parts.length !== 3)
                throw new types_1.ToolInputError(`Line ${index + 1}: use "query | relevant ids | retrieved ids (ranked)" or a JSON object.`);
            cases.push({ query: parts[0], relevant: ids(parts[1], index + 1, "relevant"), retrieved: ids(parts[2], index + 1, "retrieved") });
        }
    });
    return cases;
}
exports.parseEvalCases = parseEvalCases;
function evaluateRetrieval(cases, k) {
    const rows = cases.map(c => {
        const relevant = new Set(c.relevant);
        const top = c.retrieved.slice(0, k);
        const hits = top.map(id => relevant.has(id));
        const found = hits.filter(Boolean).length;
        const firstHit = hits.indexOf(true);
        const dcg = hits.reduce((sum, hit, i) => sum + (hit ? 1 / Math.log2(i + 2) : 0), 0);
        const ideal = Array.from({ length: Math.min(relevant.size, k) }, (_, i) => 1 / Math.log2(i + 2)).reduce((a, b) => a + b, 0);
        return {
            query: c.query,
            hit: found > 0 ? 1 : 0,
            precision: top.length ? found / k : 0,
            recall: relevant.size ? found / relevant.size : 0,
            mrr: firstHit >= 0 ? 1 / (firstHit + 1) : 0,
            ndcg: ideal ? dcg / ideal : 0
        };
    });
    const avg = (key) => rows.reduce((s, r) => s + r[key], 0) / Math.max(1, rows.length);
    return { rows, mean: { hit: avg("hit"), precision: avg("precision"), recall: avg("recall"), mrr: avg("mrr"), ndcg: avg("ndcg") } };
}
exports.evaluateRetrieval = evaluateRetrieval;
// ---------------------------------------------------------------------------
// Grounding check (lexical, per sentence)
// ---------------------------------------------------------------------------
const STOPWORDS = new Set("a an and are as at be been but by can could did do does for from had has have how i if in into is it its may might more most must no not of on or our shall should so than that the their them then there these they this those to was we were what when where which while who why will with would you your also about over under very just only".split(" "));
function contentWords(text) {
    return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).filter(w => !STOPWORDS.has(w) && (w.length > 2 || /\d/.test(w)));
}
function checkGrounding(answer, context) {
    if (!answer.trim() || !context.trim())
        throw new types_1.ToolInputError("Provide both the retrieved context and the generated answer.");
    const contextSentences = splitSentences(context).map(s => new Set(contentWords(s)));
    const contextAll = new Set(contentWords(context));
    const contextNumbers = new Set(context.match(/\d+(?:[.,]\d+)?/g) || []);
    const contextIds = new Set([
        ...(context.match(/\b[A-Za-z]+[-_]?\d+\b/g) || []),
        ...(context.match(/\[([^\]\n]{1,40})\]/g) || []).map(s => s.slice(1, -1))
    ]);
    const sentences = splitSentences(answer).map(sentence => {
        const words = [...new Set(contentWords(sentence))];
        const best = words.length
            ? Math.max(words.filter(w => contextAll.has(w)).length / words.length * 0.6 +
                Math.max(0, ...contextSentences.map(cs => words.filter(w => cs.has(w)).length / words.length)) * 0.4)
            : 1;
        const numbersMissing = (sentence.match(/\d+(?:[.,]\d+)?/g) || []).filter(n => !contextNumbers.has(n));
        const support = numbersMissing.length ? Math.min(best, 0.4) : best;
        const verdict = support >= 0.7 ? "supported" : support >= 0.4 ? "partial" : "unsupported";
        return { sentence: sentence.trim(), support, numbersMissing, verdict };
    });
    const citations = (answer.match(/\[([^\]]+)\]/g) || []).map(s => s.slice(1, -1));
    const citationsMissing = citations.filter(c => !contextIds.has(c));
    const score = sentences.reduce((s, x) => s + x.support, 0) / Math.max(1, sentences.length);
    return { sentences, score, citationsMissing };
}
exports.checkGrounding = checkGrounding;
// ---------------------------------------------------------------------------
// Hybrid search fusion
// ---------------------------------------------------------------------------
function reciprocalRankFusion(lists, k) {
    const scores = new Map();
    for (const list of lists) {
        list.ids.forEach((id, index) => {
            const entry = scores.get(id) ?? { score: 0, ranks: {} };
            entry.score += list.weight / (k + index + 1);
            entry.ranks[list.name] = index + 1;
            scores.set(id, entry);
        });
    }
    return [...scores.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score);
}
exports.reciprocalRankFusion = reciprocalRankFusion;
// ---------------------------------------------------------------------------
// Near-duplicate detection
// ---------------------------------------------------------------------------
function shingles(text, size = 3) {
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (words.length < size)
        return new Set([words.join(" ")]);
    const out = new Set();
    for (let i = 0; i <= words.length - size; i++)
        out.add(words.slice(i, i + size).join(" "));
    return out;
}
function jaccard(a, b) {
    if (!a.size && !b.size)
        return 1;
    let inter = 0;
    for (const x of a)
        if (b.has(x))
            inter++;
    return inter / (a.size + b.size - inter);
}
exports.jaccard = jaccard;
function findNearDuplicates(passages, threshold) {
    const sets = passages.map(p => shingles(p));
    const assigned = new Set();
    const groups = [];
    for (let i = 0; i < passages.length; i++) {
        if (assigned.has(i))
            continue;
        const duplicates = [];
        for (let j = i + 1; j < passages.length; j++) {
            if (assigned.has(j))
                continue;
            const similarity = jaccard(sets[i], sets[j]);
            if (similarity >= threshold) {
                duplicates.push({ index: j, similarity });
                assigned.add(j);
            }
        }
        if (duplicates.length)
            groups.push({ keep: i, duplicates });
    }
    const lowInfo = passages.map((p, i) => ({ i, words: contentWords(p).length })).filter(x => x.words < 5).map(x => x.i);
    return { groups, lowInfo };
}
exports.findNearDuplicates = findNearDuplicates;
function parseFieldRules(text) {
    return text.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).map(entry => {
        const match = /^([\w.$-]+)(\?)?\s*(?::\s*(string|number|boolean|array|object|any))?$/.exec(entry);
        if (!match)
            throw new types_1.ToolInputError(`Could not read field rule "${entry}". Use name: type, or name?: type for optional fields.`);
        return { name: match[1], optional: Boolean(match[2]), type: match[3] || "any" };
    });
}
exports.parseFieldRules = parseFieldRules;
function getPath(record, path) {
    return path.split(".").reduce((value, key) => (value && typeof value === "object" ? value[key] : undefined), record);
}
function validateChunkRecords(jsonl, rules, maxTokens) {
    const problems = [];
    const ids = new Map();
    const values = new Map();
    let records = 0;
    jsonl.split(/\r?\n/).forEach((raw, index) => {
        const line = index + 1;
        if (!raw.trim())
            return;
        let record;
        try {
            record = JSON.parse(raw);
        }
        catch {
            problems.push({ line, issue: "not valid JSON" });
            return;
        }
        records++;
        const text = record.text ?? record.page_content ?? record.content ?? record.document;
        if (typeof text !== "string" || !text.trim())
            problems.push({ line, issue: "missing or empty text (text / page_content / content)" });
        else if ((0, models_1.estimateTokens)(text) > maxTokens)
            problems.push({ line, issue: `text is ~${(0, models_1.estimateTokens)(text)} tokens, above the ${maxTokens}-token embedding limit (it will be truncated)` });
        const id = record.id ?? record.metadata?.id;
        if (id === undefined)
            problems.push({ line, issue: "no id - re-ingesting will create duplicates instead of updating" });
        else if (ids.has(String(id)))
            problems.push({ line, issue: `duplicate id "${id}" (first seen on line ${ids.get(String(id))})` });
        else
            ids.set(String(id), line);
        for (const rule of rules) {
            const value = getPath(record.metadata ?? {}, rule.name) ?? getPath(record, rule.name);
            if (value === undefined || value === null || value === "") {
                if (!rule.optional)
                    problems.push({ line, issue: `missing required field "${rule.name}"` });
                continue;
            }
            const actual = Array.isArray(value) ? "array" : typeof value;
            if (rule.type !== "any" && actual !== rule.type)
                problems.push({ line, issue: `"${rule.name}" should be ${rule.type} but is ${actual}` });
            if (!values.has(rule.name))
                values.set(rule.name, new Set());
            if (values.get(rule.name).size < 1000)
                values.get(rule.name).add(JSON.stringify(value));
        }
    });
    const cardinality = [...values.entries()].map(([name, set]) => ({ name, distinct: set.size }));
    return { records, problems, cardinality };
}
exports.validateChunkRecords = validateChunkRecords;
//# sourceMappingURL=rag.js.map