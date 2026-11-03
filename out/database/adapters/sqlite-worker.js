"use strict";
/**
 * Runs node:sqlite in a worker thread, so a long SQLite query (a full scan
 * of a 10-million-row table, a big sort) never blocks the extension host,
 * and can be stopped by terminating the worker.
 *
 * Messages: { id, op, args } in; { id, ok, result } or { id, ok: false, error } out.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require("node:sqlite");
const { file, readOnly } = worker_threads_1.workerData;
const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
db.exec("PRAGMA busy_timeout = 5000");
const toParam = (value) => (typeof value === "boolean" ? (value ? 1 : 0) : value === undefined ? null : value);
function prepare(sql) {
    const stmt = db.prepare(sql);
    // Integers beyond 2^53 stay exact; encodeValue turns them back into numbers when safe.
    stmt.setReadBigInts?.(true);
    return stmt;
}
const changes = () => Number(prepare("SELECT total_changes() AS n").get()?.n ?? 0);
const ops = {
    all(sql, params, limit, write) {
        const stmt = prepare(sql);
        const rows = [];
        if (limit && !write && typeof stmt.iterate === "function") {
            // Stops reading once the cap is passed, so a huge result never reaches memory.
            for (const row of stmt.iterate(...params.map(toParam))) {
                rows.push(row);
                if (rows.length > limit)
                    break;
            }
        }
        else {
            rows.push(...stmt.all(...params.map(toParam)));
        }
        const columns = typeof stmt.columns === "function" ? stmt.columns().map(c => c.name) : rows[0] ? Object.keys(rows[0]) : [];
        return { rows, columns };
    },
    run(sql, params) {
        return Number(prepare(sql).run(...params.map(toParam)).changes ?? 0);
    },
    script(sql) {
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
worker_threads_1.parentPort.on("message", (message) => {
    try {
        const result = ops[message.op](...(message.args ?? []));
        worker_threads_1.parentPort.postMessage({ id: message.id, ok: true, result });
    }
    catch (error) {
        const e = error;
        worker_threads_1.parentPort.postMessage({ id: message.id, ok: false, error: { message: String(e?.message ?? error), code: e?.code, errcode: e?.errcode, errstr: e?.errstr } });
    }
});
worker_threads_1.parentPort.postMessage({ id: 0, ok: true, result: "ready" });
//# sourceMappingURL=sqlite-worker.js.map