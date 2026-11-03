/**
 * Runs node:sqlite in a worker thread, so a long SQLite query (a full scan
 * of a 10-million-row table, a big sort) never blocks the extension host,
 * and can be stopped by terminating the worker.
 *
 * Messages: { id, op, args } in; { id, ok, result } or { id, ok: false, error } out.
 */

import { parentPort, workerData } from "worker_threads";

type Row = Record<string, unknown>;

interface Statement {
  all(...params: unknown[]): Row[];
  iterate?(...params: unknown[]): Iterable<Row>;
  run(...params: unknown[]): { changes?: number | bigint };
  get(...params: unknown[]): Row | undefined;
  columns?(): Array<{ name: string }>;
  setReadBigInts?(on: boolean): void;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (file: string, options?: Record<string, unknown>) => { exec(sql: string): void; prepare(sql: string): Statement; close(): void } };

const { file, readOnly } = workerData as { file: string; readOnly: boolean };
const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
db.exec("PRAGMA busy_timeout = 5000");

const toParam = (value: unknown) => (typeof value === "boolean" ? (value ? 1 : 0) : value === undefined ? null : value);

function prepare(sql: string): Statement {
  const stmt = db.prepare(sql);
  // Integers beyond 2^53 stay exact; encodeValue turns them back into numbers when safe.
  stmt.setReadBigInts?.(true);
  return stmt;
}

const changes = () => Number(prepare("SELECT total_changes() AS n").get()?.n ?? 0);

const ops: Record<string, (...args: any[]) => unknown> = {
  all(sql: string, params: unknown[], limit?: number, write?: boolean) {
    const stmt = prepare(sql);
    const rows: Row[] = [];
    if (limit && !write && typeof stmt.iterate === "function") {
      // Stops reading once the cap is passed, so a huge result never reaches memory.
      for (const row of stmt.iterate(...params.map(toParam))) {
        rows.push(row);
        if (rows.length > limit) break;
      }
    } else {
      rows.push(...stmt.all(...params.map(toParam)));
    }
    const columns = typeof stmt.columns === "function" ? stmt.columns().map(c => c.name) : rows[0] ? Object.keys(rows[0]) : [];
    return { rows, columns };
  },
  run(sql: string, params: unknown[]) {
    return Number(prepare(sql).run(...params.map(toParam)).changes ?? 0);
  },
  script(sql: string) {
    const before = changes();
    db.exec(sql);
    return { rows: [], columns: [], changes: changes() - before };
  },
  version() {
    return String(prepare("SELECT sqlite_version() AS v").get()?.v ?? "");
  },
  close() {
    db.close();
  }
};

parentPort!.on("message", (message: { id: number; op: string; args: unknown[] }) => {
  try {
    const result = ops[message.op](...(message.args ?? []));
    parentPort!.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    const e = error as { message?: string; code?: string; errcode?: number; errstr?: string };
    parentPort!.postMessage({ id: message.id, ok: false, error: { message: String(e?.message ?? error), code: e?.code, errcode: e?.errcode, errstr: e?.errstr } });
  }
});

parentPort!.postMessage({ id: 0, ok: true, result: "ready" });
