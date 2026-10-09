"use strict";
/**
 * Parses the subset of mongosh syntax the query console accepts, e.g.
 *
 *   db.users.find({ age: { $gt: 21 }, _id: ObjectId("...") }).sort({ name: 1 }).limit(20)
 *
 * Nothing is evaluated: the text is parsed into data. Shell helpers such as
 * ObjectId(), ISODate() and NumberLong() become Extended JSON ({ $oid }, { $date } ...)
 * that the adapter hands to the driver's EJSON parser. Pure, so it is unit tested.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyShellCommand = exports.MONGO_CHAIN_METHODS = exports.MONGO_DB_METHODS = exports.MONGO_WRITE_METHODS = exports.MONGO_READ_METHODS = exports.parseShellCommand = exports.parseShellObject = exports.parseShellValue = void 0;
const crypto_1 = require("crypto");
const types_1 = require("./types");
class Parser {
    constructor(src) {
        this.src = src;
        this.i = 0;
    }
    fail(message) {
        const line = this.src.slice(0, this.i).split("\n").length;
        throw new types_1.DbError(`${message} (line ${line}).`, "The console accepts mongosh syntax, e.g. db.users.find({ active: true }).limit(20)");
    }
    ws() {
        for (;;) {
            while (this.i < this.src.length && /\s/.test(this.src[this.i]))
                this.i++;
            if (this.src.startsWith("//", this.i)) {
                while (this.i < this.src.length && this.src[this.i] !== "\n")
                    this.i++;
                continue;
            }
            if (this.src.startsWith("/*", this.i)) {
                const end = this.src.indexOf("*/", this.i + 2);
                this.i = end < 0 ? this.src.length : end + 2;
                continue;
            }
            return;
        }
    }
    peek() {
        this.ws();
        return this.src[this.i] ?? "";
    }
    eat(ch) {
        if (this.peek() === ch) {
            this.i++;
            return true;
        }
        return false;
    }
    expect(ch) {
        if (!this.eat(ch))
            this.fail(`Expected "${ch}"${this.src[this.i] ? ` but found "${this.src[this.i]}"` : " but the input ended"}`);
    }
    done() {
        this.ws();
        while (this.src[this.i] === ";") {
            this.i++;
            this.ws();
        }
        return this.i >= this.src.length;
    }
    ident() {
        this.ws();
        const m = /^[A-Za-z_$][\w$]*/.exec(this.src.slice(this.i));
        if (!m)
            this.fail("Expected a name");
        this.i += m[0].length;
        return m[0];
    }
    string() {
        const quote = this.src[this.i++];
        let out = "";
        while (this.i < this.src.length) {
            const ch = this.src[this.i++];
            if (ch === quote)
                return out;
            if (ch === "\\") {
                const next = this.src[this.i++];
                const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" };
                if (next === "u") {
                    const hex = this.src.slice(this.i, this.i + 4);
                    if (!/^[0-9a-fA-F]{4}$/.test(hex))
                        this.fail("Invalid \\u escape");
                    out += String.fromCharCode(parseInt(hex, 16));
                    this.i += 4;
                }
                else
                    out += map[next] ?? next;
                continue;
            }
            out += ch;
        }
        return this.fail("Unterminated string");
    }
    number() {
        const m = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(this.src.slice(this.i));
        if (!m)
            this.fail("Expected a number");
        this.i += m[0].length;
        return Number(m[0]);
    }
    args() {
        this.expect("(");
        const out = [];
        while (!this.eat(")")) {
            out.push(this.value());
            if (!this.eat(",")) {
                this.expect(")");
                break;
            }
        }
        return out;
    }
    value() {
        const ch = this.peek();
        if (ch === "{")
            return this.object();
        if (ch === "[")
            return this.array();
        if (ch === '"' || ch === "'")
            return this.string();
        if (ch === "/")
            return this.regex();
        if (/[-\d.]/.test(ch))
            return this.number();
        if (!/[A-Za-z_$]/.test(ch))
            this.fail(ch ? `Unexpected "${ch}"` : "Unexpected end of input");
        let name = this.ident();
        if (name === "true")
            return true;
        if (name === "false")
            return false;
        if (name === "null" || name === "undefined")
            return null;
        if (name === "new")
            name = this.ident();
        if (this.peek() !== "(")
            this.fail(`"${name}" is not a value. Quote strings, e.g. "${name}"`);
        return this.helper(name, this.args());
    }
    object() {
        this.expect("{");
        const out = {};
        while (!this.eat("}")) {
            const ch = this.peek();
            const key = ch === '"' || ch === "'" ? this.string() : /[-\d]/.test(ch) ? String(this.number()) : this.ident();
            this.expect(":");
            out[key] = this.value();
            if (!this.eat(",")) {
                this.expect("}");
                break;
            }
        }
        return out;
    }
    array() {
        this.expect("[");
        const out = [];
        while (!this.eat("]")) {
            out.push(this.value());
            if (!this.eat(",")) {
                this.expect("]");
                break;
            }
        }
        return out;
    }
    regex() {
        this.i++;
        let pattern = "";
        let inClass = false;
        while (this.i < this.src.length) {
            const ch = this.src[this.i++];
            if (ch === "\\") {
                pattern += ch + (this.src[this.i++] ?? "");
                continue;
            }
            if (ch === "[")
                inClass = true;
            if (ch === "]")
                inClass = false;
            if (ch === "/" && !inClass) {
                const flags = /^[a-z]*/.exec(this.src.slice(this.i))[0];
                this.i += flags.length;
                return { $regularExpression: { pattern, options: flags.split("").sort().join("") } };
            }
            pattern += ch;
        }
        return this.fail("Unterminated regular expression");
    }
    helper(name, args) {
        const first = args[0];
        const str = (label) => {
            if (typeof first !== "string" && typeof first !== "number")
                this.fail(`${name}() expects ${label}`);
            return String(first);
        };
        switch (name) {
            case "ObjectId":
            case "ObjectID":
                if (first === undefined)
                    return { $oid: newObjectIdHex() };
                if (!/^[0-9a-fA-F]{24}$/.test(String(first)))
                    this.fail(`ObjectId("${String(first).slice(0, 30)}") must be 24 hex characters`);
                return { $oid: String(first).toLowerCase() };
            case "ISODate":
            case "Date": {
                const date = first === undefined ? new Date() : new Date(typeof first === "number" ? first : String(first));
                if (Number.isNaN(date.getTime()))
                    this.fail(`${name}(${JSON.stringify(first)}) is not a valid date`);
                return { $date: date.toISOString() };
            }
            case "NumberLong":
            case "Long":
                if (!/^-?\d+$/.test(str("an integer")))
                    this.fail(`${name}() expects an integer`);
                return { $numberLong: String(first) };
            case "NumberInt":
            case "Int32":
                if (!/^-?\d+$/.test(str("an integer")))
                    this.fail(`${name}() expects an integer`);
                return { $numberInt: String(first) };
            case "NumberDecimal":
            case "Decimal128":
                return { $numberDecimal: str("a number") };
            case "Double":
                return { $numberDouble: str("a number") };
            case "UUID": {
                const value = first === undefined ? randomUuid() : str("a UUID");
                if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value))
                    this.fail("UUID() expects a UUID string");
                return { $uuid: value.replace(/^(.{8})-?(.{4})-?(.{4})-?(.{4})-?(.{12})$/, "$1-$2-$3-$4-$5").toLowerCase() };
            }
            case "Timestamp": {
                if (first && typeof first === "object")
                    return { $timestamp: first };
                return { $timestamp: { t: Number(first ?? 0), i: Number(args[1] ?? 0) } };
            }
            case "BinData":
                return { $binary: { base64: String(args[1] ?? ""), subType: Number(first ?? 0).toString(16).padStart(2, "0") } };
            case "RegExp":
                return { $regularExpression: { pattern: str("a pattern"), options: String(args[1] ?? "") } };
            case "MinKey":
                return { $minKey: 1 };
            case "MaxKey":
                return { $maxKey: 1 };
            default:
                return this.fail(`${name}() is not supported. Use ObjectId, ISODate, NumberLong, NumberInt, NumberDecimal, UUID, Timestamp, BinData or RegExp`);
        }
    }
}
function newObjectIdHex() {
    const time = Math.floor(Date.now() / 1000).toString(16).padStart(8, "0");
    return time + (0, crypto_1.randomBytes)(8).toString("hex");
}
function randomUuid() {
    const b = (0, crypto_1.randomBytes)(16);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return b.toString("hex").replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}
/** Parses one value written in relaxed (shell) JSON into Extended JSON. */
function parseShellValue(text) {
    const parser = new Parser(text);
    if (parser.done())
        throw new types_1.DbError("Enter a value.");
    const value = parser.value();
    if (!parser.done())
        parser.fail("Unexpected text after the value");
    return value;
}
exports.parseShellValue = parseShellValue;
/** Parses a JSON object (strict or shell syntax); an empty string is an empty filter. */
function parseShellObject(text, label) {
    if (!String(text ?? "").trim())
        return {};
    const value = parseShellValue(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new types_1.DbError(`${label} must be an object, e.g. { "status": "active" }.`);
    return value;
}
exports.parseShellObject = parseShellObject;
/** Parses one console command. Only data is produced; nothing is evaluated. */
function parseShellCommand(text) {
    const trimmed = String(text ?? "").trim();
    if (!trimmed)
        throw new types_1.DbError("Enter a command, e.g. db.users.find({}).limit(20)");
    const show = /^show\s+(collections|tables|dbs|databases)\s*;?$/i.exec(trimmed);
    if (show)
        return { kind: "show", what: /collections|tables/i.test(show[1]) ? "collections" : "dbs" };
    const p = new Parser(trimmed);
    if (p.ident() !== "db")
        p.fail("Commands start with db., e.g. db.users.find({})");
    let collection;
    let method;
    let args = [];
    if (p.eat("[")) {
        const ch = p.peek();
        if (ch !== '"' && ch !== "'")
            p.fail("Expected a quoted collection name");
        collection = p.string();
        p.expect("]");
    }
    else {
        p.expect(".");
        const name = p.ident();
        if (p.peek() === "(") {
            const callArgs = p.args();
            if (name === "getCollection") {
                if (typeof callArgs[0] !== "string")
                    p.fail("getCollection() expects a collection name");
                collection = callArgs[0];
            }
            else {
                method = name;
                args = callArgs;
            }
        }
        else {
            collection = name;
        }
    }
    if (collection === undefined) {
        if (!p.done())
            p.fail("Run one command at a time");
        return { kind: "db", method: method, args };
    }
    if (!collection || collection.length > 255)
        p.fail("Invalid collection name");
    p.expect(".");
    method = p.ident();
    if (p.peek() !== "(")
        p.fail(`Call ${method}(...)`);
    args = p.args();
    const chain = [];
    while (p.eat(".")) {
        const name = p.ident();
        chain.push({ method: name, args: p.peek() === "(" ? p.args() : [] });
    }
    if (!p.done())
        p.fail("Run one command at a time");
    return { kind: "collection", collection, method, args, chain };
}
exports.parseShellCommand = parseShellCommand;
exports.MONGO_READ_METHODS = new Set(["find", "findOne", "aggregate", "countDocuments", "estimatedDocumentCount", "count", "distinct", "getIndexes", "indexes", "listIndexes", "stats"]);
exports.MONGO_WRITE_METHODS = new Set(["insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete", "bulkWrite", "createIndex", "dropIndex", "dropIndexes", "drop", "renameCollection"]);
exports.MONGO_DB_METHODS = new Set(["getCollectionNames", "listCollections", "stats", "runCommand", "createCollection", "dropDatabase", "version", "getName"]);
exports.MONGO_CHAIN_METHODS = new Set(["sort", "limit", "skip", "project", "projection", "hint", "collation", "maxTimeMS", "toArray", "pretty", "count", "batchSize", "comment", "allowDiskUse"]);
const isEmptyObject = (value) => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0;
/** Whether a command writes, and why it needs confirmation if it destroys data. */
function classifyShellCommand(command) {
    if (command.kind === "show")
        return { write: false, verb: "show" };
    if (command.kind === "db") {
        if (!exports.MONGO_DB_METHODS.has(command.method))
            throw new types_1.DbError(`db.${command.method}() is not supported here.`, `Supported: ${[...exports.MONGO_DB_METHODS].map(m => `db.${m}()`).join(", ")}.`);
        if (command.method === "dropDatabase")
            return { write: true, verb: "dropDatabase", danger: "db.dropDatabase() deletes the whole database and every collection in it." };
        if (command.method === "createCollection")
            return { write: true, verb: "createCollection" };
        // runCommand can do anything, so it is treated as a write.
        return { write: command.method === "runCommand", verb: command.method };
    }
    const { method, args, collection } = command;
    if (!exports.MONGO_READ_METHODS.has(method) && !exports.MONGO_WRITE_METHODS.has(method)) {
        throw new types_1.DbError(`${method}() is not supported here.`, `Supported: ${[...exports.MONGO_READ_METHODS, ...exports.MONGO_WRITE_METHODS].join(", ")}.`);
    }
    for (const link of command.chain) {
        if (!exports.MONGO_CHAIN_METHODS.has(link.method))
            throw new types_1.DbError(`.${link.method}() is not supported after ${method}().`);
    }
    if (method === "aggregate") {
        const pipeline = Array.isArray(args[0]) ? args[0] : [];
        const writes = pipeline.some(stage => stage && typeof stage === "object" && ("$out" in stage || "$merge" in stage));
        return { write: writes, verb: method, danger: writes ? "This pipeline writes its output into a collection with $out/$merge, replacing data there." : undefined };
    }
    if (!exports.MONGO_WRITE_METHODS.has(method))
        return { write: false, verb: method };
    let danger;
    if (method === "drop")
        danger = `drop() deletes the collection "${collection}" and all its documents.`;
    else if (method === "deleteMany")
        danger = isEmptyObject(args[0]) ? `deleteMany({}) deletes every document in "${collection}".` : `deleteMany() deletes the matching documents in "${collection}".`;
    else if (method === "deleteOne" || method === "findOneAndDelete")
        danger = `${method}() deletes a document from "${collection}".`;
    else if (method === "updateMany" && isEmptyObject(args[0]))
        danger = `updateMany({}) changes every document in "${collection}".`;
    else if (method === "dropIndex" || method === "dropIndexes")
        danger = `${method}() removes indexes from "${collection}".`;
    else if (method === "renameCollection")
        danger = `renameCollection() renames "${collection}"; code using the old name will break.`;
    else if (method === "bulkWrite")
        danger = "bulkWrite() may delete or replace documents.";
    return { write: true, verb: method, danger };
}
exports.classifyShellCommand = classifyShellCommand;
//# sourceMappingURL=mongo-shell.js.map