import * as assert from "assert";
import { decodeXmlBytes, parseXml, XmlSyntaxError } from "../../toolkits/engines/xml-parse";
import { jsonStats, stringify, xmlToJson } from "../../toolkits/engines/xml-json";
import { findTool } from "../../toolkits/registry";
import { ToolContext } from "../../toolkits/types";
import { codeFrame } from "../../toolkits/sections/text";
import { suite, test } from "./run-unit-tests";

const compact = (xml: string, options = {}) => xmlToJson(xml, options).value;

function syntaxError(xml: string): XmlSyntaxError {
  try {
    parseXml(xml);
  } catch (error) {
    if (error instanceof XmlSyntaxError) return error;
    throw error;
  }
  assert.fail(`expected an error for ${xml}`);
}

suite("xml → json: compact mapping", () => {
  test("attributes, text, repeated elements, empty elements and the prolog", () => {
    assert.deepStrictEqual(compact('<?xml version="1.0" encoding="UTF-8"?><!--top--><r a="1"><x>one</x><x>two</x><e/><f></f><g b="2"/><h c="3">t</h></r>'), {
      "?xml": { "@version": "1.0", "@encoding": "UTF-8" },
      "#comment": "top",
      r: { "@a": "1", x: ["one", "two"], e: "", f: "", g: { "@b": "2" }, h: { "@c": "3", "#text": "t" } }
    });
  });

  test("namespaces keep their prefixes and declarations, or lose the prefixes on request", () => {
    const xml = '<soap:Envelope xmlns:soap="urn:s" xmlns:m="urn:m"><soap:Body><m:Price>34.5</m:Price></soap:Body></soap:Envelope>';
    assert.deepStrictEqual(compact(xml), { "soap:Envelope": { "@xmlns:soap": "urn:s", "@xmlns:m": "urn:m", "soap:Body": { "m:Price": "34.5" } } });
    assert.deepStrictEqual(compact(xml, { stripPrefixes: true }), { Envelope: { "@xmlns:soap": "urn:s", "@xmlns:m": "urn:m", Body: { Price: "34.5" } } });
    const clash = xmlToJson('<r xmlns:a="urn:a" xmlns:b="urn:b"><a:i>1</a:i><b:i>2</b:i></r>', { stripPrefixes: true });
    assert.deepStrictEqual(clash.value, { r: { "@xmlns:a": "urn:a", "@xmlns:b": "urn:b", i: ["1", "2"] } });
    assert.ok(clash.notes.some(n => /same/.test(n)), "merging prefixed names is pointed out");
  });

  test("entities, character references and special characters decode exactly", () => {
    assert.deepStrictEqual(compact('<a t="&quot;q&quot; &amp; &apos;">&lt;tag&gt; &amp; &#65;&#x42; &#x1F600; é 日本 "quotes"</a>'), { a: { "@t": "\"q\" & '", "#text": "<tag> & AB 😀 é 日本 \"quotes\"" } });
    assert.deepStrictEqual(compact('<!DOCTYPE a [<!ENTITY co "ACME &amp; Co"><!ENTITY full "&co; Ltd">]><a>&full;</a>'), { "!DOCTYPE": '<!DOCTYPE a [<!ENTITY co "ACME &amp; Co"><!ENTITY full "&co; Ltd">]>', a: "ACME & Co Ltd" });
  });

  test("CDATA is kept verbatim, merged into the text or under #cdata", () => {
    assert.deepStrictEqual(compact("<a>  <![CDATA[  <b> & ]]>  </a>"), { a: "  <b> & " }, "CDATA whitespace survives trimming");
    assert.deepStrictEqual(compact("<a>x<![CDATA[y]]></a>", { cdataKey: true }), { a: { "#cdata": "y", "#text": "x" } });
  });

  test("whitespace: indentation goes, xml:space=preserve and the trim switch keep it", () => {
    assert.deepStrictEqual(compact("<a>\n  <b>  padded  </b>\n</a>"), { a: { b: "padded" } });
    assert.deepStrictEqual(compact("<a>\n  <b>  padded  </b>\n</a>", { trim: false }), { a: { b: "  padded  ", "#text": "\n  \n" } });
    assert.deepStrictEqual(compact('<a xml:space="preserve"><b>  x </b></a>'), { a: { "@xml:space": "preserve", b: "  x " } });
    assert.deepStrictEqual(compact("<a>line1\r\nline2</a>"), { a: "line1\nline2" }, "line endings are normalised as XML requires");
    assert.deepStrictEqual(compact('<a v="x\ty\nz"/>'), { a: { "@v": "x y z" } }, "attribute values are normalised as XML requires");
  });

  test("mixed content keeps all text and says the order isn't kept", () => {
    const r = xmlToJson("<p>Hello <b>big</b> world<i>!</i></p>");
    assert.deepStrictEqual(r.value, { p: { b: "big", i: "!", "#text": "Hello world" } });
    assert.ok(r.notes.some(n => /Lossless/.test(n)));
  });

  test("options: arrays everywhere, typed values that round-trip, comments and prolog off, other prefixes", () => {
    assert.deepStrictEqual(compact("<r><a>1</a></r>", { alwaysArray: true, prolog: false }), { r: [{ a: ["1"] }] });
    assert.deepStrictEqual(compact('<r n="42"><a>007</a><a>1.50</a><a>-3.25</a><a>true</a><a>9007199254740993</a><a>1e3</a><a>False</a></r>', { coerce: true }),
      { r: { "@n": 42, a: ["007", "1.50", -3.25, true, "9007199254740993", "1e3", "False"] } });
    assert.deepStrictEqual(compact('<?xml version="1.0"?><!--c--><r><!--d-->x</r>', { comments: false, prolog: false }), { r: "x" });
    assert.deepStrictEqual(compact('<r id="1">t</r>', { attributePrefix: "$" }), { r: { $id: "1", "#text": "t" } });
  });

  test("names that look like object internals stay ordinary keys", () => {
    const value = compact('<__proto__ constructor="c"><toString>t</toString></__proto__>') as Record<string, unknown>;
    assert.strictEqual(Object.getPrototypeOf(value), Object.prototype);
    assert.ok(Object.prototype.hasOwnProperty.call(value, "__proto__"));
    assert.strictEqual(stringify(value, ""), '{"__proto__":{"@constructor":"c","toString":"t"}}');
    assert.strictEqual(({} as Record<string, unknown>).toString === Object.prototype.toString, true, "nothing was polluted");
  });
});

suite("xml → json: lossless mapping", () => {
  test("keeps every node in order, with namespace URIs", () => {
    const xml = '<?xml version="1.0"?><?pi data?><r xmlns="urn:d" xmlns:x="urn:x"><x:a k="v">Hi <b>there</b>!</x:a><![CDATA[c]]><!--n--></r>';
    assert.deepStrictEqual(xmlToJson(xml, { mapping: "lossless" }).value, {
      declaration: { version: "1.0" },
      nodes: [
        { type: "instruction", target: "pi", data: "data" },
        {
          type: "element", name: "r", namespace: "urn:d", attributes: { xmlns: "urn:d", "xmlns:x": "urn:x" }, children: [
            { type: "element", name: "x:a", namespace: "urn:x", attributes: { k: "v" }, children: [{ type: "text", text: "Hi " }, { type: "element", name: "b", namespace: "urn:d", children: [{ type: "text", text: "there" }] }, { type: "text", text: "!" }] },
            { type: "cdata", text: "c" },
            { type: "comment", text: "n" }
          ]
        }
      ]
    });
  });
});

suite("xml → json: validation", () => {
  const cases: Array<[string, number, number, RegExp]> = [
    ["", 1, 1, /empty/],
    ['{"a": 1}', 1, 1, /before the root/],
    ["<a><b></a>", 1, 7, /<\/a> doesn't match <b>, opened on line 1, column 4/],
    ["<a>\n  <b>x</c>\n</a>", 2, 7, /<\/c> doesn't match <b>, opened on line 2, column 3/],
    ["<a>", 1, 4, /never closed/],
    ["<a/><b/>", 1, 5, /second root/],
    ["<a/>tail", 1, 5, /after the root/],
    ["<a b=1/>", 1, 6, /quotes/],
    ['<a b="1" b="2"/>', 1, 10, /twice/],
    ["<a b/>", 1, 5, /no value/],
    ["<a>Tom & Jerry</a>", 1, 8, /&amp;|reference/],
    ["<a>&nbsp;</a>", 1, 4, /isn't defined/],
    ["<a>&#0;</a>", 1, 4, /doesn't allow/],
    ["<a>&#65=;</a>", 1, 4, /character reference/],
    ["<a><!-- x -- y --></a>", 1, 11, /"--"/],
    ["<a><![CDATA[x</a>", 1, 4, /CDATA/],
    ["<1a/>", 1, 2, /can't start/],
    ['\n<?xml version="1.0"?><a/>', 2, 1, /very start/],
    ["<x:a/>", 1, 2, /isn't declared/],
    ['<a xmlns:x="u" xmlns:y="u" x:b="1" y:b="2"/>', 1, 36, /same namespace/],
    ["<a :b='1'/>", 1, 4, /colon/],
    ["<a>]]></a>", 1, 4, /\]\]>/],
    ["<!DOCTYPE [<!ENTITY e 'v'>]><a/>", 1, 11, /name after <!DOCTYPE/],
    ["<a>\u0001</a>", 1, 4, /isn't allowed/],
    ["<?pi:x d?><a/>", 1, 3, /colon/]
  ];
  for (const [xml, line, column, message] of cases) {
    test(`${JSON.stringify(xml.slice(0, 40))} → line ${line}, column ${column}`, () => {
      const error = syntaxError(xml);
      assert.match(error.message, message);
      assert.deepStrictEqual([error.line, error.column], [line, column]);
    });
  }

  test("HTML entities get the numeric reference that works", () => {
    assert.match(syntaxError("<a>&copy;</a>").hint!, /&#169;/);
  });

  test("entity bombs and self-referencing entities are stopped", () => {
    const levels = ["a", "b", "c", "d", "e", "f", "g"];
    const decls = levels.map((name, k) => `<!ENTITY ${name} "${k === levels.length - 1 ? "x".repeat(50) : `&${levels[k + 1]};`.repeat(10)}">`).join("");
    assert.match(syntaxError(`<!DOCTYPE r [${decls}]><r>&a;</r>`).message, /10 million/);
    assert.match(syntaxError('<!DOCTYPE r [<!ENTITY r "&r;">]><r>&r;</r>').message, /refers to itself/);
  });

  test("entities from an external DTD are kept as written, with a warning", () => {
    const r = xmlToJson('<!DOCTYPE r SYSTEM "r.dtd"><r>&ext;</r>');
    assert.strictEqual((r.value as Record<string, unknown>).r, "&ext;");
    assert.match(r.warnings[0].message, /external DTD/);
  });

  test("binary property lists are recognised", () => {
    assert.match(syntaxError("bplist00\u0000\u0001").message, /binary property list/);
  });

  test("code frames point at the column, tabs included", () => {
    assert.strictEqual(codeFrame("<a>\n\t<b>x</c>\n</a>", 2, 8), "  1 | <a>\n> 2 | \t<b>x</c>\n    | \t      ^\n  3 | </a>");
  });
});

suite("xml → json: encodings, depth and size", () => {
  test("decodes UTF-8, UTF-16 with and without a BOM, and declared single-byte encodings", () => {
    const xml = '<?xml version="1.0"?><a>é</a>';
    assert.strictEqual(decodeXmlBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml)])).text, xml);
    assert.strictEqual(decodeXmlBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")])).text, xml);
    assert.deepStrictEqual(decodeXmlBytes(Buffer.from(xml, "utf16le")), { text: xml, encoding: "UTF-16LE" });
    const latin = Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><a>caf\u00e9</a>', "latin1");
    assert.deepStrictEqual(compact(decodeXmlBytes(latin).text, { prolog: false }), { a: "café" });
  });

  test("5,000 levels deep convert and serialise; deeper is refused", () => {
    const deep = "<a>".repeat(5000) + "x" + "</a>".repeat(5000);
    const value = xmlToJson(deep).value;
    assert.strictEqual(stringify(value, "").length, 5000 * 6 + 3, '{"a": per level, then "x" and the closing braces');
    assert.strictEqual(jsonStats(value).objects, 5000);
    assert.ok(stringify(xmlToJson(deep, { mapping: "lossless" }).value, " ").length > 0);
    assert.match(syntaxError("<a>".repeat(5001) + "</a>".repeat(5001)).message, /5,000 levels/);
  });

  test("a 10 MB document converts in a few seconds, and stringify matches JSON.stringify", () => {
    let xml = "<orders>";
    for (let i = 0; i < 50_000; i++) xml += `<order id="${i}"><customer>Customer ${i} &amp; Co</customer><total currency="EUR">${(i * 1.25).toFixed(2)}</total><items><item sku="A${i}">2</item><item sku="B${i}">1</item></items></order>`;
    xml += "</orders>";
    const started = Date.now();
    const r = xmlToJson(xml, { coerce: true });
    const json = stringify(r.value, "  ");
    assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
    assert.strictEqual(r.stats.elements, 300_001);
    assert.strictEqual(json, JSON.stringify(r.value, null, "  "));
  });
});

suite("xml → json: the tool", () => {
  const tool = findTool("text.xml-json")!;

  test("converts the sample with stats, a summary and a downloadable JSON output", async () => {
    const result = await tool.run({ input: '<r a="1"><b>2</b></r>', mapping: "compact", output: "pretty", indent: "4" }, {});
    const output = result.outputs![0] as { kind: string; content: string; fileName?: string; language: string };
    assert.strictEqual(output.language, "json");
    assert.strictEqual(output.fileName, "converted.json");
    assert.strictEqual(output.content, '{\n    "r": {\n        "@a": "1",\n        "b": "2"\n    }\n}\n');
    assert.ok(result.messages!.some(m => m.kind === "success" && /2 elements, 1 attribute/.test(m.text)));
    const minified = await tool.run({ input: '<r a="1"><b>2</b></r>', output: "minified" }, {});
    assert.strictEqual((minified.outputs![0] as { content: string }).content, '{"r":{"@a":"1","b":"2"}}\n');
  });

  test("malformed XML returns the error, the fix and where it is (not an exception)", async () => {
    const result = await tool.run({ input: "<a>\n  <b>x</c>\n</a>" }, {});
    assert.strictEqual(result.messages![0].kind, "error");
    assert.match(result.messages![0].text, /^Line 2, column 7: /);
    assert.match((result.outputs![0] as { content: string }).content, /> 2 \|/);
  });

  test("every preset runs", async () => {
    for (const example of tool.examples ?? []) {
      const result = await tool.run(example.values, {});
      assert.ok(result.outputs?.length, example.label);
    }
  });

  test("Convert a file… decodes the file, saves the JSON next to it and previews it", async () => {
    let saved: { content: string; name: string; near?: string } | undefined;
    const context: ToolContext = {
      files: {
        pick: async () => ({ name: "feed.xml", path: "/data/feed.xml", bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<rss><item>é</item><item>b</item></rss>", "utf16le")]) }),
        save: async (content, options) => { saved = { content, name: options.suggestedName, near: options.near }; return "/data/feed.json"; }
      }
    };
    const result = await tool.run({ output: "minified" }, context, "file");
    assert.deepStrictEqual(saved, { content: '{"rss":{"item":["é","b"]}}\n', name: "feed.json", near: "/data/feed.xml" });
    assert.ok(result.messages!.some(m => m.kind === "success" && /saved \/data\/feed\.json/.test(m.text)));
    assert.ok(result.stats!.some(s => s.value === "UTF-16LE"));
    const cancelled = await tool.run({}, { files: { pick: async () => undefined, save: async () => undefined } }, "file");
    assert.match(cancelled.messages![0].text, /No file chosen/);
  });

  test("the JSON / YAML / XML Formatter converts XML too", async () => {
    const formatter = findTool("text.format")!;
    const json = await formatter.run({ input: "<a><b>1</b><b>2</b></a>", format: "auto", action: "to-json", indent: "2" }, {});
    assert.strictEqual((json.outputs![0] as { content: string }).content, '{\n  "a": {\n    "b": [\n      "1",\n      "2"\n    ]\n  }\n}\n');
    const yaml = await formatter.run({ input: "<a><b>1</b></a>", format: "xml", action: "to-yaml", indent: "2" }, {});
    assert.match((yaml.outputs![0] as { content: string }).content, /^a:\n {2}b: "1"/);
  });
});
