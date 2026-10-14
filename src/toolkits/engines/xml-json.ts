import { parseXml, ParseResult, XmlDocument, XmlElement, XmlNode, XmlStats, XmlWarning } from "./xml-parse";

/**
 * XML → JSON, in two mappings.
 *
 * Compact: the JSON people expect. An element with only text becomes a
 * string; otherwise an object of "@attributes", child elements (repeated
 * names become arrays, in document order) and "#text". Nothing in the XML
 * infoset is dropped except the relative order of differently named
 * siblings and of text around child elements (mixed content), which the
 * result warns about.
 *
 * Lossless: every node, in order, as { type, name, attributes, children }.
 * It keeps mixed content, comments, instructions, CDATA boundaries and
 * namespace URIs, so the XML can be rebuilt exactly from it.
 */

export type Mapping = "compact" | "lossless";

export interface ConvertOptions {
  mapping: Mapping;
  /** Prefix for attribute keys in the compact mapping ("@", "-" or "$"); none of these can start an XML name, so keys never collide. */
  attributePrefix: string;
  textKey: string;
  /** Put every child element in an array, even when it occurs once (a stable shape for code). */
  alwaysArray: boolean;
  /** Turn "42", "-3.5", "true" into numbers and booleans, only when the JSON value prints back to exactly the same text. */
  coerce: boolean;
  /** Drop whitespace-only text (indentation) and trim text values; never inside xml:space="preserve" or CDATA. */
  trim: boolean;
  /** Keep comments ("#comment"). */
  comments: boolean;
  /** Keep CDATA as "#cdata" instead of merging it into the text. */
  cdataKey: boolean;
  /** Keep the XML declaration, doctype and processing instructions ("?xml", "!DOCTYPE", "?target"). */
  prolog: boolean;
  /** Use local names (Envelope instead of soap:Envelope). Namespace declarations are kept as attributes. */
  stripPrefixes: boolean;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  mapping: "compact",
  attributePrefix: "@",
  textKey: "#text",
  alwaysArray: false,
  coerce: false,
  trim: true,
  comments: true,
  cdataKey: false,
  prolog: true,
  stripPrefixes: false
};

export interface ConvertResult {
  value: unknown;
  stats: XmlStats;
  warnings: XmlWarning[];
  /** Notes about the mapping (not problems with the XML). */
  notes: string[];
}

export function xmlToJson(xml: string, options: Partial<ConvertOptions> = {}): ConvertResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parsed = parseXml(xml);
  return convertParsed(parsed, opts);
}

export function convertParsed(parsed: ParseResult, opts: ConvertOptions): ConvertResult {
  const notes: string[] = [];
  const value = opts.mapping === "lossless" ? toLossless(parsed.document, opts) : toCompact(parsed.document, opts, notes);
  return { value, stats: parsed.stats, warnings: parsed.warnings, notes };
}

// ---------------------------------------------------------------- compact

const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;

function coerceValue(text: string, on: boolean): string | number | boolean {
  if (!on) return text;
  if (text === "true") return true;
  if (text === "false") return false;
  if (NUMBER.test(text)) {
    const n = Number(text);
    // Only when nothing is lost: "007", "1.50", "1e3" and huge integers stay text.
    if (Number.isFinite(n) && String(n) === text && (!Number.isInteger(n) || Number.isSafeInteger(n))) return n;
  }
  return text;
}

function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

/** Adds a value under a key, turning a second occurrence into an array. */
function put(target: Record<string, unknown>, key: string, value: unknown, array: boolean): void {
  if (!Object.prototype.hasOwnProperty.call(target, key)) {
    target[key] = array ? [value] : value;
    return;
  }
  const existing = target[key];
  if (Array.isArray(existing) && (array || (existing as unknown[] & { __multi?: true }).__multi)) existing.push(value);
  else {
    const list = [existing, value] as unknown[] & { __multi?: true };
    // Mark arrays we created, so an element whose value is itself an array is never flattened into it.
    Object.defineProperty(list, "__multi", { value: true, enumerable: false });
    target[key] = list;
  }
}

function toCompact(doc: XmlDocument, opts: ConvertOptions, notes: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  const state = { mixed: false, prefixClash: false };
  const nameOf = (name: string) => (opts.stripPrefixes ? localName(name) : name);
  if (opts.prolog && doc.declaration) {
    const decl: Record<string, string> = {};
    decl[`${opts.attributePrefix}version`] = doc.declaration.version;
    if (doc.declaration.encoding) decl[`${opts.attributePrefix}encoding`] = doc.declaration.encoding;
    if (doc.declaration.standalone) decl[`${opts.attributePrefix}standalone`] = doc.declaration.standalone;
    out["?xml"] = decl;
  }
  for (const node of doc.children) {
    if (node.type === "element") put(out, nameOf(node.name), compactElement(node, opts, state, nameOf), opts.alwaysArray);
    else if (node.type === "comment" && opts.comments) put(out, "#comment", node.value, false);
    else if (node.type === "instruction" && opts.prolog) put(out, `?${node.target}`, node.data, false);
    else if (node.type === "doctype" && opts.prolog) out["!DOCTYPE"] = node.value;
  }
  if (state.mixed) notes.push("Some elements mix text and child elements. Compact JSON keeps all of the text under \"" + opts.textKey + "\", but not where it sat between the children; choose Lossless to keep the order.");
  if (state.prefixClash) notes.push("Removing namespace prefixes made some element names the same (e.g. a:item and b:item), so they were merged into one array. Keep prefixes to tell them apart.");
  return plain(out) as Record<string, unknown>;
}

function compactElement(root: XmlElement, opts: ConvertOptions, state: { mixed: boolean; prefixClash: boolean }, nameOf: (n: string) => string): unknown {
  // Iterative post-order walk, so very deep documents can't overflow the stack.
  interface Frame { element: XmlElement; index: number; obj: Record<string, unknown>; parts: Array<{ text: string; cdata: boolean; afterElement: boolean }>; hasElements: boolean; boundary: boolean; names: Map<string, string>; }
  const open = (element: XmlElement): Frame => {
    const obj: Record<string, unknown> = Object.create(null);
    for (const [name, value] of element.attributes) obj[opts.attributePrefix + (opts.stripPrefixes && !name.startsWith("xmlns") ? localName(name) : name)] = coerceValue(value, opts.coerce);
    return { element, index: 0, obj, parts: [], hasElements: false, boundary: false, names: new Map() };
  };
  const finish = (frame: Frame): unknown => {
    const { element, obj, parts } = frame;
    const keep = !opts.trim || element.preserveSpace;
    // Indentation-only text goes; the ends of the remaining text are trimmed, but CDATA is never touched.
    const pieces = keep ? parts : parts.filter(p => p.cdata || p.text.trim());
    let text = "";
    let spaceBefore = false;
    pieces.forEach((p, i) => {
      if (keep || p.cdata) { text += p.text; spaceBefore = false; return; }
      let t = p.text;
      // Around a child element, whitespace collapses to one space ("Hello <b>x</b> world" → "Hello world"), and none is added where there was none.
      const gap = p.afterElement && (spaceBefore || /^\s/.test(t));
      if (i === 0 || p.afterElement) t = t.replace(/^\s+/, "");
      const next = pieces[i + 1];
      spaceBefore = !!next && next.afterElement && /\s$/.test(t);
      if (!next || next.afterElement) t = t.replace(/\s+$/, "");
      text += (gap && text && t ? " " : "") + t;
    });
    if (frame.hasElements && parts.some(p => !p.cdata && p.text.trim())) state.mixed = true;
    if (Object.keys(obj).length === 0) return text === "" ? "" : coerceValue(text, opts.coerce && !parts.some(p => p.cdata));
    if (text !== "") obj[opts.textKey] = coerceValue(text, opts.coerce && !parts.some(p => p.cdata));
    return obj;
  };
  const stack: Frame[] = [open(root)];
  let result: unknown;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const child: XmlNode | undefined = frame.element.children[frame.index++];
    if (!child) {
      const value = finish(frame);
      stack.pop();
      if (!stack.length) { result = value; break; }
      const parent = stack[stack.length - 1];
      const key = nameOf(frame.element.name);
      const seen = parent.names.get(key);
      if (seen !== undefined && seen !== frame.element.name) state.prefixClash = true;
      parent.names.set(key, frame.element.name);
      put(parent.obj, key, value, opts.alwaysArray);
      continue;
    }
    switch (child.type) {
      case "element": frame.hasElements = true; frame.boundary = true; stack.push(open(child)); break;
      case "text": frame.parts.push({ text: child.value, cdata: false, afterElement: frame.boundary }); frame.boundary = false; break;
      case "cdata":
        if (opts.cdataKey) put(frame.obj, "#cdata", child.value, false);
        else { frame.parts.push({ text: child.value, cdata: true, afterElement: frame.boundary }); frame.boundary = false; }
        break;
      case "comment": if (opts.comments) put(frame.obj, "#comment", child.value, false); break;
      case "instruction": put(frame.obj, `?${child.target}`, child.data, false); break;
      default: break;
    }
  }
  return result;
}

/** Copies objects made with Object.create(null) into ordinary ones (JSON.stringify handles both; callers and tests prefer plain). */
function plain(value: unknown): unknown {
  const stack: Array<{ from: unknown; to: Record<string, unknown> | unknown[] }> = [];
  const wrap = (v: unknown): unknown => {
    if (Array.isArray(v)) { const copy: unknown[] = []; stack.push({ from: v, to: copy }); return copy; }
    if (v && typeof v === "object") { const copy: Record<string, unknown> = {}; stack.push({ from: v, to: copy }); return copy; }
    return v;
  };
  const top = wrap(value);
  while (stack.length) {
    const { from, to } = stack.pop()!;
    if (Array.isArray(from)) for (const item of from) (to as unknown[]).push(wrap(item));
    // defineProperty, not assignment: <__proto__> is a valid element name and must stay an ordinary key.
    else for (const key of Object.keys(from as object)) Object.defineProperty(to, key, { value: wrap((from as Record<string, unknown>)[key]), enumerable: true, writable: true, configurable: true });
  }
  return top;
}

// ---------------------------------------------------------------- lossless

function toLossless(doc: XmlDocument, opts: ConvertOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (doc.declaration) out.declaration = { ...doc.declaration };
  out.nodes = losslessNodes(doc.children, opts, false);
  return out;
}

function losslessNodes(nodes: XmlNode[], opts: ConvertOptions, preserve: boolean): unknown[] {
  // Iterative too: each frame fills one children array.
  const result: unknown[] = [];
  const stack: Array<{ nodes: XmlNode[]; index: number; into: unknown[]; preserve: boolean }> = [{ nodes, index: 0, into: result, preserve }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const node = frame.nodes[frame.index++];
    if (!node) { stack.pop(); continue; }
    switch (node.type) {
      case "element": {
        const el: Record<string, unknown> = { type: "element", name: node.name };
        if (node.namespace) el.namespace = node.namespace;
        if (node.attributes.length) el.attributes = Object.fromEntries(node.attributes);
        if (node.children.length) {
          const children: unknown[] = [];
          el.children = children;
          stack.push({ nodes: node.children, index: 0, into: children, preserve: !!node.preserveSpace });
        }
        frame.into.push(el);
        break;
      }
      case "text":
        // Indentation between elements is formatting, not data; real text is kept exactly.
        if (opts.trim && !frame.preserve && !node.value.trim()) break;
        frame.into.push({ type: "text", text: node.value });
        break;
      case "cdata": frame.into.push({ type: "cdata", text: node.value }); break;
      case "comment": frame.into.push({ type: "comment", text: node.value }); break;
      case "instruction": frame.into.push({ type: "instruction", target: node.target, data: node.data }); break;
      case "doctype": frame.into.push({ type: "doctype", text: node.value }); break;
    }
  }
  // Elements whose only children were indentation end up with an empty list.
  return result;
}

/** Counts how many JSON nodes a value has (for the stats line), without recursion. */
export function jsonStats(value: unknown): { objects: number; arrays: number; values: number } {
  const counts = { objects: 0, arrays: 0, values: 0 };
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (Array.isArray(v)) { counts.arrays++; for (const item of v) stack.push(item); }
    else if (v && typeof v === "object") { counts.objects++; for (const key of Object.keys(v)) stack.push((v as Record<string, unknown>)[key]); }
    else counts.values++;
  }
  return counts;
}

/**
 * JSON.stringify without recursion, so documents nested thousands of levels
 * deep serialise too. Same output as JSON.stringify(value, null, indent).
 */
export function stringify(value: unknown, indent: string): string {
  const parts: string[] = [];
  const nl = indent ? "\n" : "";
  const sep = indent ? ": " : ":";
  type Frame = { kind: "arr"; items: unknown[]; i: number; depth: number } | { kind: "obj"; keys: string[]; obj: Record<string, unknown>; i: number; depth: number };
  const stack: Frame[] = [];
  const pad = (depth: number) => (indent ? indent.repeat(depth) : "");
  const emit = (v: unknown, depth: number) => {
    if (Array.isArray(v)) {
      if (!v.length) { parts.push("[]"); return; }
      parts.push("[");
      stack.push({ kind: "arr", items: v, i: 0, depth: depth + 1 });
    } else if (v && typeof v === "object") {
      const keys = Object.keys(v);
      if (!keys.length) { parts.push("{}"); return; }
      parts.push("{");
      stack.push({ kind: "obj", keys, obj: v as Record<string, unknown>, i: 0, depth: depth + 1 });
    } else {
      parts.push(v === undefined ? "null" : JSON.stringify(v));
    }
  };
  emit(value, 0);
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const count = frame.kind === "arr" ? frame.items.length : frame.keys.length;
    if (frame.i >= count) {
      stack.pop();
      parts.push(nl + pad(frame.depth - 1) + (frame.kind === "arr" ? "]" : "}"));
      continue;
    }
    parts.push((frame.i ? "," : "") + nl + pad(frame.depth));
    if (frame.kind === "arr") emit(frame.items[frame.i++], frame.depth);
    else {
      const key = frame.keys[frame.i++];
      parts.push(JSON.stringify(key) + sep);
      emit(frame.obj[key], frame.depth);
    }
  }
  return parts.join("");
}
