"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomUUID = exports.randomBytes = void 0;
const buffer_1 = require("buffer");
/** Web Crypto caps each getRandomValues call at 65536 bytes. */
function randomBytes(size) {
    const bytes = new Uint8Array(size);
    for (let offset = 0; offset < size; offset += 65536)
        crypto.getRandomValues(bytes.subarray(offset, Math.min(size, offset + 65536)));
    return buffer_1.Buffer.from(bytes);
}
exports.randomBytes = randomBytes;
const randomUUID = () => crypto.randomUUID();
exports.randomUUID = randomUUID;
//# sourceMappingURL=random.js.map