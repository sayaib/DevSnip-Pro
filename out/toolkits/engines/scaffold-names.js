"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pluralOf = exports.kebabOf = exports.camelOf = exports.pascalOf = exports.words = void 0;
/** Naming shared by frontend and backend scaffold templates. */
function words(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean).map(w => w.toLowerCase());
}
exports.words = words;
const pascalOf = (name) => words(name).map(w => w[0].toUpperCase() + w.slice(1)).join("") || "Item";
exports.pascalOf = pascalOf;
const camelOf = (name) => { const p = (0, exports.pascalOf)(name); return p[0].toLowerCase() + p.slice(1); };
exports.camelOf = camelOf;
const kebabOf = (name) => words(name).join("-") || "item";
exports.kebabOf = kebabOf;
function pluralOf(word) {
    if (/[^aeiou]y$/i.test(word))
        return word.slice(0, -1) + "ies";
    if (/(s|x|z|ch|sh)$/i.test(word))
        return word + "es";
    return word + "s";
}
exports.pluralOf = pluralOf;
//# sourceMappingURL=scaffold-names.js.map