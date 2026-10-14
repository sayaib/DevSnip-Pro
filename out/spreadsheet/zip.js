"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crc32 = exports.writeZip = exports.ZipReader = exports.MAX_ENTRY_BYTES = void 0;
const zlib = __importStar(require("zlib"));
const types_1 = require("./types");
/**
 * A minimal read-only ZIP reader, enough for Office Open XML packages.
 *
 * .xlsx files are ZIP archives of XML parts. Reading them needs only the
 * central directory and raw DEFLATE, which Node's zlib provides, so the
 * viewer ships without a spreadsheet dependency.
 */
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
/** An entry larger than this when inflated is refused (zip bombs, V8's string limit). */
exports.MAX_ENTRY_BYTES = 256 * 1024 * 1024;
class ZipReader {
    constructor(data) {
        this.data = data;
        this.entries = new Map();
        const eocd = findEndOfCentralDirectory(data);
        const count = data.readUInt16LE(eocd + 10);
        const size = data.readUInt32LE(eocd + 12);
        let at = data.readUInt32LE(eocd + 16);
        if (count === 0xffff || size === 0xffffffff || at === 0xffffffff) {
            throw new types_1.SpreadsheetError("This workbook uses ZIP64, which the viewer doesn't read.", "Save it again from Excel or LibreOffice; workbooks under 4 GB don't need ZIP64.");
        }
        for (let i = 0; i < count; i++) {
            if (at + 46 > data.length || data.readUInt32LE(at) !== CENTRAL)
                throw corrupt();
            const flags = data.readUInt16LE(at + 8);
            const nameLength = data.readUInt16LE(at + 28);
            const extraLength = data.readUInt16LE(at + 30);
            const commentLength = data.readUInt16LE(at + 32);
            // Bit 11 marks UTF-8 names; Office always writes ASCII part names, so latin1 is a safe fallback.
            const name = data.toString(flags & 0x800 ? "utf8" : "latin1", at + 46, at + 46 + nameLength);
            this.entries.set(name.replace(/\\/g, "/").replace(/^\//, ""), {
                name,
                method: data.readUInt16LE(at + 10),
                compressedSize: data.readUInt32LE(at + 20),
                size: data.readUInt32LE(at + 24),
                offset: data.readUInt32LE(at + 42),
                encrypted: (flags & 1) === 1,
                crc: data.readUInt32LE(at + 16),
                time: data.readUInt16LE(at + 12),
                date: data.readUInt16LE(at + 14)
            });
            at += 46 + nameLength + extraLength + commentLength;
        }
    }
    names() {
        return [...this.entries.keys()];
    }
    has(name) {
        return this.entries.has(name);
    }
    /** The entry's compressed bytes and header fields, for copying it unchanged. */
    raw(name) {
        const entry = this.entries.get(name);
        if (!entry)
            return undefined;
        const at = entry.offset;
        if (at + 30 > this.data.length || this.data.readUInt32LE(at) !== LOCAL)
            throw corrupt();
        const start = at + 30 + this.data.readUInt16LE(at + 26) + this.data.readUInt16LE(at + 28);
        return { name: entry.name, method: entry.method, crc: entry.crc, size: entry.size, time: entry.time, date: entry.date, data: this.data.subarray(start, start + entry.compressedSize) };
    }
    /** The entry's bytes, or undefined when it doesn't exist. */
    read(name) {
        const entry = this.entries.get(name);
        if (!entry)
            return undefined;
        if (entry.encrypted)
            throw new types_1.SpreadsheetError("This workbook is password-protected.", "Remove the password in Excel (File → Info → Protect Workbook), then open it again.");
        if (entry.size > exports.MAX_ENTRY_BYTES)
            throw tooLarge();
        const raw = this.raw(name).data;
        if (entry.method === 0)
            return raw;
        if (entry.method !== 8)
            throw new types_1.SpreadsheetError(`This workbook uses a compression method (${entry.method}) the viewer doesn't read.`, "Save it again from Excel or LibreOffice.");
        try {
            return zlib.inflateRawSync(raw, { maxOutputLength: exports.MAX_ENTRY_BYTES });
        }
        catch (error) {
            if (error instanceof RangeError || error.code === "ERR_BUFFER_TOO_LARGE")
                throw tooLarge();
            throw corrupt();
        }
    }
    /** The entry decoded as UTF-8 text (with a byte-order mark removed), or undefined. */
    text(name) {
        const bytes = this.read(name);
        if (!bytes)
            return undefined;
        const text = bytes.toString("utf8");
        return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    }
}
exports.ZipReader = ZipReader;
/**
 * Writes a ZIP archive. Entries given as RawEntry are copied as they are
 * (still compressed); entries given as bytes are deflated. Data descriptors
 * are never written: sizes and CRCs go in the local headers.
 */
function writeZip(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = dosTime(new Date());
    for (const entry of entries) {
        const raw = "content" in entry
            ? { name: entry.name, method: 8, crc: crc32(entry.content), size: entry.content.length, time: now.time, date: now.date, data: zlib.deflateRawSync(entry.content) }
            : entry;
        const name = Buffer.from(raw.name, "utf8");
        const flags = /[^\x00-\x7f]/.test(raw.name) ? 0x800 : 0;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(LOCAL, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(raw.method, 8);
        local.writeUInt16LE(raw.time, 10);
        local.writeUInt16LE(raw.date, 12);
        local.writeUInt32LE(raw.crc >>> 0, 14);
        local.writeUInt32LE(raw.data.length, 18);
        local.writeUInt32LE(raw.size, 22);
        local.writeUInt16LE(name.length, 26);
        const header = Buffer.alloc(46);
        header.writeUInt32LE(CENTRAL, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(20, 6);
        header.writeUInt16LE(flags, 8);
        header.writeUInt16LE(raw.method, 10);
        header.writeUInt16LE(raw.time, 12);
        header.writeUInt16LE(raw.date, 14);
        header.writeUInt32LE(raw.crc >>> 0, 16);
        header.writeUInt32LE(raw.data.length, 20);
        header.writeUInt32LE(raw.size, 24);
        header.writeUInt16LE(name.length, 28);
        header.writeUInt32LE(offset, 42);
        chunks.push(local, name, raw.data);
        central.push(header, name);
        offset += 30 + name.length + raw.data.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(EOCD, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...chunks, directory, end]);
}
exports.writeZip = writeZip;
let crcTable;
function crc32(data) {
    if (!crcTable) {
        crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++)
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < data.length; i++)
        crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}
exports.crc32 = crc32;
function dosTime(d) {
    return {
        time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
        date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
}
function findEndOfCentralDirectory(data) {
    // The record is 22 bytes plus a comment of up to 65,535 bytes, at the very end.
    const stop = Math.max(0, data.length - 22 - 0xffff);
    for (let at = data.length - 22; at >= stop; at--) {
        if (data.readUInt32LE(at) === EOCD)
            return at;
    }
    throw corrupt();
}
function corrupt() {
    return new types_1.SpreadsheetError("This file isn't a valid .xlsx workbook, or it is damaged.", "Open it in Excel or LibreOffice and save it again as an Excel Workbook (.xlsx).");
}
function tooLarge() {
    return new types_1.SpreadsheetError("This workbook is too large to open here.", "Split it into smaller workbooks, or export the sheet you need as CSV.");
}
//# sourceMappingURL=zip.js.map