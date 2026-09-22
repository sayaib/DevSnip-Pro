"use strict";
/**
 * Request builders and response normalisers for the vector databases the RAG
 * and vector-search tools talk to.
 *
 * Each vendor has a different search endpoint, auth header and result shape.
 * Normalising them to one `VectorMatch` means the RAG pipeline tool does not
 * care which database is behind it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.groundingScore = exports.parseVectorResponse = exports.buildVectorQuery = exports.getVectorDb = exports.VECTOR_DBS = void 0;
exports.VECTOR_DBS = [
    {
        id: "qdrant",
        label: "Qdrant",
        baseUrlHint: "http://localhost:6333",
        collectionLabel: "Collection",
        requiresKey: false,
        docsUrl: "https://qdrant.tech/documentation/concepts/search/"
    },
    {
        id: "pinecone",
        label: "Pinecone",
        baseUrlHint: "https://<index>-<project>.svc.<env>.pinecone.io",
        collectionLabel: "Namespace",
        requiresKey: true,
        docsUrl: "https://docs.pinecone.io/reference/api/data-plane/query"
    },
    {
        id: "weaviate",
        label: "Weaviate",
        baseUrlHint: "http://localhost:8080",
        collectionLabel: "Class",
        requiresKey: false,
        docsUrl: "https://weaviate.io/developers/weaviate/api/rest"
    },
    {
        id: "chroma",
        label: "Chroma",
        baseUrlHint: "http://localhost:8000",
        collectionLabel: "Collection id",
        requiresKey: false,
        docsUrl: "https://docs.trychroma.com/reference/js-collection"
    },
    {
        id: "custom",
        label: "Custom endpoint",
        baseUrlHint: "https://api.example.com/search",
        collectionLabel: "Collection",
        requiresKey: false,
        docsUrl: ""
    }
];
function trimBase(url) {
    return url.replace(/\/+$/, "");
}
function getVectorDb(id) {
    const entry = exports.VECTOR_DBS.find(db => db.id === id);
    if (!entry)
        throw new Error(`Unknown vector database "${id}".`);
    return entry;
}
exports.getVectorDb = getVectorDb;
function buildVectorQuery(options) {
    const base = trimBase(options.baseUrl);
    const topK = Math.max(1, Math.min(options.topK || 5, 100));
    switch (options.db) {
        case "qdrant":
            return {
                url: `${base}/collections/${encodeURIComponent(options.collection)}/points/search`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(options.apiKey ? { "api-key": options.apiKey } : {})
                },
                body: { vector: options.vector, limit: topK, with_payload: options.includePayload !== false }
            };
        case "pinecone":
            return {
                url: `${base}/query`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(options.apiKey ? { "Api-Key": options.apiKey } : {})
                },
                body: {
                    vector: options.vector,
                    topK,
                    includeMetadata: options.includePayload !== false,
                    ...(options.collection ? { namespace: options.collection } : {})
                }
            };
        case "weaviate": {
            // Weaviate's REST search is GraphQL; nearVector keeps this vendor-neutral.
            const className = options.collection || "Document";
            const query = `{ Get { ${className}(nearVector: {vector: ${JSON.stringify(options.vector)}}, limit: ${topK}) { _additional { id distance } } } }`;
            return {
                url: `${base}/v1/graphql`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
                },
                body: { query }
            };
        }
        case "chroma":
            return {
                url: `${base}/api/v1/collections/${encodeURIComponent(options.collection)}/query`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
                },
                body: {
                    query_embeddings: [options.vector],
                    n_results: topK,
                    include: ["documents", "metadatas", "distances"]
                }
            };
        default:
            return {
                url: base,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {})
                },
                body: { vector: options.vector, topK, collection: options.collection }
            };
    }
}
exports.buildVectorQuery = buildVectorQuery;
/** Pulls readable text out of a payload without assuming a field name. */
function payloadText(payload) {
    for (const key of ["text", "content", "chunk", "document", "page_content", "body"]) {
        const value = payload[key];
        if (typeof value === "string" && value.trim())
            return value;
    }
    // Fall back to the longest string field.
    const strings = Object.values(payload).filter((value) => typeof value === "string");
    return strings.sort((a, b) => b.length - a.length)[0] ?? "";
}
function parseVectorResponse(db, payload) {
    const data = payload && typeof payload === "object" ? payload : undefined;
    if (!data)
        return [];
    switch (db) {
        case "qdrant": {
            const result = Array.isArray(data.result) ? data.result : [];
            return result.map((entry) => {
                const inner = (entry?.payload ?? {});
                return { id: String(entry?.id ?? ""), score: Number(entry?.score ?? 0), text: payloadText(inner), payload: inner };
            });
        }
        case "pinecone": {
            const matches = Array.isArray(data.matches) ? data.matches : [];
            return matches.map((entry) => {
                const inner = (entry?.metadata ?? {});
                return { id: String(entry?.id ?? ""), score: Number(entry?.score ?? 0), text: payloadText(inner), payload: inner };
            });
        }
        case "weaviate": {
            const get = data.data?.Get ?? {};
            const first = Object.values(get)[0];
            const rows = Array.isArray(first) ? first : [];
            return rows.map((entry) => {
                const { _additional, ...rest } = entry ?? {};
                const distance = Number(_additional?.distance ?? 0);
                return {
                    id: String(_additional?.id ?? ""),
                    // Weaviate reports distance; convert so higher is always better.
                    score: Number.isFinite(distance) ? 1 - distance : 0,
                    text: payloadText(rest),
                    payload: rest
                };
            });
        }
        case "chroma": {
            const ids = data.ids?.[0] ?? [];
            const documents = data.documents?.[0] ?? [];
            const distances = data.distances?.[0] ?? [];
            const metadatas = data.metadatas?.[0] ?? [];
            return ids.map((id, index) => ({
                id: String(id),
                score: Number.isFinite(distances[index]) ? 1 - distances[index] : 0,
                text: documents[index] ?? "",
                payload: metadatas[index] ?? {}
            }));
        }
        default: {
            const rows = Array.isArray(data.matches) ? data.matches : Array.isArray(data.results) ? data.results : [];
            return rows.map((entry, index) => {
                const inner = (entry?.metadata ?? entry?.payload ?? {});
                return {
                    id: String(entry?.id ?? index),
                    score: Number(entry?.score ?? 0),
                    text: typeof entry?.text === "string" ? entry.text : payloadText(inner),
                    payload: inner
                };
            });
        }
    }
}
exports.parseVectorResponse = parseVectorResponse;
/**
 * Fraction of an answer's sentences that are supported by the retrieved
 * context. A transparent lexical-overlap heuristic, not a model judgement:
 * it needs no extra API call and is explainable to the user.
 */
function groundingScore(answer, context) {
    const sentences = answer
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(sentence => sentence.length > 15);
    if (!sentences.length)
        return { score: 0, supported: 0, total: 0 };
    const contextTokens = new Set(context
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(token => token.length > 3));
    let supported = 0;
    for (const sentence of sentences) {
        const tokens = sentence
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(token => token.length > 3);
        if (!tokens.length)
            continue;
        const overlap = tokens.filter(token => contextTokens.has(token)).length / tokens.length;
        if (overlap >= 0.5)
            supported++;
    }
    return { score: supported / sentences.length, supported, total: sentences.length };
}
exports.groundingScore = groundingScore;
//# sourceMappingURL=vector-db.js.map