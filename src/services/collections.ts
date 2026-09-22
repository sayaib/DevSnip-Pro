import * as vscode from "vscode";
import { FeatureAccessService } from "../premium/feature-access";

/**
 * Saved request collections.
 *
 * The free tier keeps a limited number of saved requests and the premium tier
 * is unlimited with import/export - but that rule lives in the feature
 * registry, and this store asks FeatureAccessService rather than deciding for
 * itself. Chaining runs through here too, since a chain is just an ordered run
 * over saved requests.
 */

export interface SavedRequest {
  id: string;
  name: string;
  folder: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Record<string, string>;
  body?: string;
  bodyType?: string;
  authType?: string;
  /**
   * Values extracted from this request's response into variables for later
   * steps: variable name -> JSON path.
   */
  extract?: Record<string, string>;
  updatedAt: number;
}

export interface CollectionExport {
  kind: "devsnip-collection";
  version: 1;
  exportedAt: string;
  requests: SavedRequest[];
}

const STORE_KEY = "devsnip.apiClient.collections";

function sanitiseRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === "string" && typeof entry === "string") out[key] = entry;
  }
  return out;
}

/** Rebuilds a request from untrusted input (webview message or imported file). */
export function sanitiseRequest(value: unknown): SavedRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const url = typeof source.url === "string" ? source.url.trim() : "";
  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : url;
  if (!url || !name) return undefined;

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

export class CollectionStore {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly access: FeatureAccessService
  ) {}

  list(): SavedRequest[] {
    const stored = this.context.globalState.get<unknown>(STORE_KEY);
    if (!Array.isArray(stored)) return [];
    return stored
      .map(entry => sanitiseRequest(entry))
      .filter((entry): entry is SavedRequest => Boolean(entry))
      .sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
  }

  get(id: string): SavedRequest | undefined {
    return this.list().find(request => request.id === id);
  }

  private async write(requests: SavedRequest[]): Promise<void> {
    const next = this.writeQueue.then(() => this.context.globalState.update(STORE_KEY, requests));
    this.writeQueue = next.catch(() => undefined);
    await next;
  }

  /**
   * Saves a request. The free-tier cap is enforced here, at the storage layer,
   * so it cannot be bypassed by a webview that does not render the limit.
   */
  async save(input: unknown): Promise<{ saved: SavedRequest; total: number }> {
    const request = sanitiseRequest(input);
    if (!request) throw new Error("A saved request needs at least a name and a URL.");

    const existing = this.list();
    const isUpdate = existing.some(entry => entry.id === request.id);

    if (!isUpdate) {
      const limit = this.access.limitFor("collections-basic");
      if (limit && limit.max !== "unlimited" && existing.length >= limit.max) {
        throw new Error(
          `The free tier stores up to ${limit.max} saved requests (you have ${existing.length}). Delete one, or upgrade to Premium for unlimited collections.`
        );
      }
    }

    const next = isUpdate
      ? existing.map(entry => (entry.id === request.id ? request : entry))
      : [...existing, request];
    await this.write(next);
    return { saved: request, total: next.length };
  }

  async delete(id: string): Promise<number> {
    const next = this.list().filter(request => request.id !== id);
    await this.write(next);
    return next.length;
  }

  /** Premium: the whole collection as a portable document. */
  export(): CollectionExport {
    return {
      kind: "devsnip-collection",
      version: 1,
      exportedAt: new Date().toISOString(),
      requests: this.list()
    };
  }

  /** Premium: merges an exported collection, replacing entries with the same id. */
  async import(payload: unknown): Promise<{ imported: number; skipped: number; total: number }> {
    const document = payload as Partial<CollectionExport> | undefined;
    const incoming = Array.isArray(document?.requests) ? document!.requests : Array.isArray(payload) ? payload : undefined;
    if (!incoming) throw new Error("That file is not a DevSnip Pro collection export.");

    const sanitised = incoming
      .map(entry => sanitiseRequest(entry))
      .filter((entry): entry is SavedRequest => Boolean(entry));
    const skipped = incoming.length - sanitised.length;

    const byId = new Map(this.list().map(request => [request.id, request]));
    for (const request of sanitised) byId.set(request.id, request);

    const next = [...byId.values()];
    await this.write(next);
    return { imported: sanitised.length, skipped, total: next.length };
  }
}
