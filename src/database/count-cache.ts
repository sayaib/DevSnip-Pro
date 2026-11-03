/**
 * Remembers row counts per query, so paging through a filtered table counts
 * it once rather than on every page. COUNT(*) is the expensive half of a
 * page on large tables: a full scan on PostgreSQL and InnoDB.
 *
 * Bounded (oldest entries go first) and short-lived; adapters clear it after
 * every write.
 */

export interface CachedCount {
  total: number;
  /** From table statistics rather than COUNT(*). */
  estimated?: boolean;
}

/** Unfiltered tables at least this large show the statistics estimate instead of being counted. */
export const LARGE_TABLE_ROWS = 1_000_000;

/**
 * A text search on a table at least this large is not counted: the search
 * cannot use an index, so counting would scan the whole table a second
 * time. The grid pages on, and the user can still ask for the count.
 */
export const SEARCH_COUNT_ROWS = 100_000;

export class CountCache {
  private readonly entries = new Map<string, { at: number; value: CachedCount }>();

  constructor(private readonly ttlMs = 30_000, private readonly max = 100) {}

  get(key: string): CachedCount | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: CachedCount): void {
    this.entries.delete(key);
    this.entries.set(key, { at: Date.now(), value });
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value as string);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
