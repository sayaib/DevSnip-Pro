"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectionStore = exports.sanitiseRequest = void 0;
const STORE_KEY = "devsnip.apiClient.collections";
function sanitiseRecord(value) {
    const out = {};
    if (!value || typeof value !== "object")
        return out;
    for (const [key, entry] of Object.entries(value)) {
        if (typeof key === "string" && typeof entry === "string")
            out[key] = entry;
    }
    return out;
}
/** Rebuilds a request from untrusted input (webview message or imported file). */
function sanitiseRequest(value) {
    if (!value || typeof value !== "object")
        return undefined;
    const source = value;
    const url = typeof source.url === "string" ? source.url.trim() : "";
    const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : url;
    if (!url || !name)
        return undefined;
    return {
        id: typeof source.id === "string" && source.id ? source.id : `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: name.slice(0, 120),
        folder: typeof source.folder === "string" ? source.folder.slice(0, 80) : "Default",
        method: typeof source.method === "string" ? source.method.toUpperCase().slice(0, 10) : "GET",
        url: url.slice(0, 2000),
        headers: sanitiseRecord(source.headers),
        params: sanitiseRecord(source.params),
        body: typeof source.body === "string" ? source.body.slice(0, 200000) : undefined,
        bodyType: typeof source.bodyType === "string" ? source.bodyType : undefined,
        authType: typeof source.authType === "string" ? source.authType : undefined,
        extract: sanitiseRecord(source.extract),
        updatedAt: Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now()
    };
}
exports.sanitiseRequest = sanitiseRequest;
class CollectionStore {
    constructor(context, access) {
        this.context = context;
        this.access = access;
        this.writeQueue = Promise.resolve();
    }
    list() {
        const stored = this.context.globalState.get(STORE_KEY);
        if (!Array.isArray(stored))
            return [];
        return stored
            .map(entry => sanitiseRequest(entry))
            .filter((entry) => Boolean(entry))
            .sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
    }
    get(id) {
        return this.list().find(request => request.id === id);
    }
    async write(requests) {
        const next = this.writeQueue.then(() => this.context.globalState.update(STORE_KEY, requests));
        this.writeQueue = next.catch(() => undefined);
        await next;
    }
    /**
     * Saves a request. The free-tier cap is enforced here, at the storage layer,
     * so it cannot be bypassed by a webview that does not render the limit.
     */
    async save(input) {
        const request = sanitiseRequest(input);
        if (!request)
            throw new Error("A saved request needs at least a name and a URL.");
        const existing = this.list();
        const isUpdate = existing.some(entry => entry.id === request.id);
        if (!isUpdate) {
            const limit = this.access.limitFor("collections-basic");
            if (limit && limit.max !== "unlimited" && existing.length >= limit.max) {
                throw new Error(`The free tier stores up to ${limit.max} saved requests (you have ${existing.length}). Delete one, or upgrade to Premium for unlimited collections.`);
            }
        }
        const next = isUpdate
            ? existing.map(entry => (entry.id === request.id ? request : entry))
            : [...existing, request];
        await this.write(next);
        return { saved: request, total: next.length };
    }
    async delete(id) {
        const next = this.list().filter(request => request.id !== id);
        await this.write(next);
        return next.length;
    }
    /** Premium: the whole collection as a portable document. */
    export() {
        return {
            kind: "devsnip-collection",
            version: 1,
            exportedAt: new Date().toISOString(),
            requests: this.list()
        };
    }
    /** Premium: merges an exported collection, replacing entries with the same id. */
    async import(payload) {
        const document = payload;
        const incoming = Array.isArray(document?.requests) ? document.requests : Array.isArray(payload) ? payload : undefined;
        if (!incoming)
            throw new Error("That file is not a DevSnip Pro collection export.");
        const sanitised = incoming
            .map(entry => sanitiseRequest(entry))
            .filter((entry) => Boolean(entry));
        const skipped = incoming.length - sanitised.length;
        const byId = new Map(this.list().map(request => [request.id, request]));
        for (const request of sanitised)
            byId.set(request.id, request);
        const next = [...byId.values()];
        await this.write(next);
        return { imported: sanitised.length, skipped, total: next.length };
    }
}
exports.CollectionStore = CollectionStore;
//# sourceMappingURL=collections.js.map