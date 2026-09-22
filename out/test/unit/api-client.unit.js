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
const assert = __importStar(require("assert"));
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const api_test_1 = require("../../commands/api-test");
const vscode_stub_1 = require("./vscode-stub");
const run_unit_tests_1 = require("./run-unit-tests");
function tester() {
    return new api_test_1.ApiTester((0, vscode_stub_1.createExtensionContext)());
}
(0, run_unit_tests_1.suite)("REST client request building", () => {
    (0, run_unit_tests_1.test)("redacts credential-like query values before they are stored", () => {
        assert.strictEqual(api_test_1.ApiTester.redactUrl("https://api.example.com/v1?api_key=supersecret&page=2"), "https://api.example.com/v1?api_key=%5Bredacted%5D&page=2");
        assert.strictEqual(api_test_1.ApiTester.redactUrl("https://api.example.com/v1?token=abc&access_token=def"), "https://api.example.com/v1?token=%5Bredacted%5D&access_token=%5Bredacted%5D");
    });
    (0, run_unit_tests_1.test)("leaves ordinary query parameters and malformed URLs untouched", () => {
        assert.strictEqual(api_test_1.ApiTester.redactUrl("https://example.com/x?page=2&sort=name"), "https://example.com/x?page=2&sort=name");
        assert.strictEqual(api_test_1.ApiTester.redactUrl("not a url"), "not a url");
    });
    (0, run_unit_tests_1.test)("rejects unsupported protocols and malformed URLs", () => {
        const client = tester();
        for (const url of ["file:///etc/passwd", "ftp://example.com", "not-a-url", ""]) {
            assert.throws(() => client.generateCurlCommand({ method: "GET", url }), /Invalid URL format/, `${url} should be rejected`);
        }
    });
    (0, run_unit_tests_1.test)("builds a cURL command with headers, query parameters and a body", () => {
        const curl = tester().generateCurlCommand({
            method: "POST",
            url: "https://api.example.com/items",
            params: { page: "2" },
            headers: { "X-Trace": "abc" },
            data: '{"name":"test"}'
        });
        assert.ok(curl.startsWith("curl -X POST"));
        assert.ok(curl.includes("-H 'X-Trace: abc'"));
        assert.ok(curl.includes("page=2"));
        assert.ok(curl.includes(`-d '{"name":"test"}'`));
    });
    (0, run_unit_tests_1.test)("quoting survives a real shell, so an exported cURL cannot inject a command", () => {
        // A harmless payload with the same shape as an injection attempt.
        const payload = `a'; echo INJECTED; echo '`;
        const quoted = (0, api_test_1.shellQuote)(payload);
        if (os.platform() === "win32") {
            // No POSIX shell to verify against; check the escaping form instead.
            assert.ok(quoted.startsWith("'") && quoted.endsWith("'"));
            assert.ok(!/[^\\]'[^\\']/.test(quoted.slice(1, -1)));
            return;
        }
        // If the quoting were breakable, the shell would run the echo and the
        // output would differ from the literal payload.
        const output = (0, child_process_1.execFileSync)("/bin/sh", ["-c", `printf %s ${quoted}`], { encoding: "utf8" });
        assert.strictEqual(output, payload);
        assert.ok(!output.includes("INJECTED\n"), "nothing may be executed by the shell");
    });
    (0, run_unit_tests_1.test)("a header value with shell metacharacters stays one argument", () => {
        const curl = tester().generateCurlCommand({
            method: "GET",
            url: "https://example.com/",
            headers: { "X-Evil": `a'; echo INJECTED; echo '` }
        });
        assert.ok(curl.includes(`'\\''`), "single quotes use the POSIX escape idiom");
        if (os.platform() !== "win32") {
            // Ask the shell how many arguments the generated command really has.
            const args = (0, child_process_1.execFileSync)("/bin/sh", ["-c", `set -- ${curl.slice("curl ".length)}; printf '%s\\n' "$#"`], { encoding: "utf8" }).trim();
            assert.strictEqual(args, "5", "-X GET -H <one header> <url>");
        }
    });
    (0, run_unit_tests_1.test)("applies each supported authentication style", () => {
        const bearer = tester().generateCurlCommand({
            method: "GET", url: "https://example.com/", authType: "Bearer", authToken: "tok123"
        });
        assert.ok(bearer.includes("-H 'Authorization: Bearer tok123'"));
        const basic = tester().generateCurlCommand({
            method: "GET", url: "https://example.com/", authType: "Basic", username: "u", password: "p"
        });
        assert.ok(basic.includes("-u 'u:p'"));
        const headerKey = tester().generateCurlCommand({
            method: "GET", url: "https://example.com/", authType: "ApiKey", apiKeyName: "X-Key", apiKeyValue: "v", apiKeyLocation: "header"
        });
        assert.ok(headerKey.includes("-H 'X-Key: v'"));
        const queryKey = tester().generateCurlCommand({
            method: "GET", url: "https://example.com/", authType: "ApiKey", apiKeyName: "key", apiKeyValue: "v", apiKeyLocation: "query"
        });
        assert.ok(queryKey.includes("key=v"));
    });
    (0, run_unit_tests_1.test)("resolves environment variables into url, headers and body", async () => {
        const client = tester();
        await client.saveEnvironment({ name: "dev", variables: { host: "api.dev.example.com", token: "t0k" } });
        await client.setActiveEnvironment(0);
        const curl = client.generateCurlCommand({
            method: "GET",
            url: "https://{{host}}/v1/status",
            headers: { Authorization: "Bearer {{token}}" }
        });
        assert.ok(curl.includes("https://api.dev.example.com/v1/status"));
        assert.ok(curl.includes("Bearer t0k"));
    });
    (0, run_unit_tests_1.test)("an unknown variable is left in place rather than blanked out", async () => {
        const client = tester();
        await client.saveEnvironment({ name: "dev", variables: {} });
        await client.setActiveEnvironment(0);
        const curl = client.generateCurlCommand({ method: "GET", url: "https://example.com/{{missing}}" });
        assert.ok(curl.includes("%7B%7Bmissing%7D%7D") || curl.includes("{{missing}}"));
    });
    (0, run_unit_tests_1.test)("rejects malformed JSON when the content type says JSON", () => {
        assert.throws(() => tester().generateCurlCommand({
            method: "POST",
            url: "https://example.com/",
            headers: { "Content-Type": "application/json" },
            data: "{ not json"
        }), /Invalid JSON in request body/);
    });
    (0, run_unit_tests_1.test)("encodes a form-urlencoded body", () => {
        const curl = tester().generateCurlCommand({
            method: "POST",
            url: "https://example.com/",
            bodyType: "form-urlencoded",
            data: '{"a":"1","b":"two words"}'
        });
        assert.ok(curl.includes("a=1&b=two+words"));
        assert.ok(curl.includes("application/x-www-form-urlencoded"));
    });
    (0, run_unit_tests_1.test)("wraps GraphQL queries into a JSON payload", () => {
        const curl = tester().generateCurlCommand({
            method: "POST",
            url: "https://example.com/graphql",
            requestType: "graphql",
            graphqlQuery: "query Q { me { id } }",
            graphqlVariables: '{"x":1}'
        });
        assert.ok(curl.includes('"query"'));
        assert.ok(curl.includes('"variables"'));
        assert.ok(curl.includes("application/json"));
    });
    (0, run_unit_tests_1.test)("reports invalid GraphQL variables clearly", () => {
        assert.throws(() => tester().generateCurlCommand({
            method: "POST", url: "https://example.com/graphql", requestType: "graphql",
            graphqlQuery: "{ me { id } }", graphqlVariables: "{oops"
        }), /Invalid GraphQL variables JSON/);
    });
});
(0, run_unit_tests_1.suite)("REST client cURL import", () => {
    (0, run_unit_tests_1.test)("parses method, headers, body and url", () => {
        const parsed = tester().parseCurlCommand(`curl -X POST 'https://api.example.com/items' -H 'Content-Type: application/json' -d '{"a":1}'`);
        assert.strictEqual(parsed.method, "POST");
        assert.strictEqual(parsed.url, "https://api.example.com/items");
        assert.strictEqual(parsed.headers?.["Content-Type"], "application/json");
        assert.strictEqual(parsed.data, '{"a":1}');
    });
    (0, run_unit_tests_1.test)("infers POST from a data flag and parses basic auth", () => {
        const parsed = tester().parseCurlCommand(`curl https://example.com -d 'x=1' -u 'user:pass'`);
        assert.strictEqual(parsed.method, "POST");
        assert.strictEqual(parsed.authType, "Basic");
        assert.strictEqual(parsed.username, "user");
        assert.strictEqual(parsed.password, "pass");
    });
    (0, run_unit_tests_1.test)("round-trips a generated command", () => {
        const client = tester();
        const curl = client.generateCurlCommand({
            method: "PUT",
            url: "https://example.com/items/1",
            headers: { "X-Trace": "abc" },
            data: '{"name":"x"}'
        });
        const parsed = client.parseCurlCommand(curl);
        assert.strictEqual(parsed.method, "PUT");
        assert.strictEqual(parsed.url, "https://example.com/items/1");
        assert.strictEqual(parsed.headers?.["X-Trace"], "abc");
    });
    (0, run_unit_tests_1.test)("rejects input that is not a cURL command", () => {
        assert.throws(() => tester().parseCurlCommand("wget https://example.com"), /Not a valid cURL command/);
        assert.throws(() => tester().parseCurlCommand("curl -X GET"), /No URL found/);
    });
});
(0, run_unit_tests_1.suite)("REST client history", () => {
    (0, run_unit_tests_1.test)("exports JSON and CSV", () => {
        const client = tester();
        assert.deepStrictEqual(JSON.parse(client.exportHistory("json")), []);
        assert.ok(client.exportHistory("csv").startsWith("id,method,url,status"));
    });
    (0, run_unit_tests_1.test)("clearing history and cookies empties both stores", () => {
        const client = tester();
        client.clearHistory();
        client.clearCookies();
        assert.deepStrictEqual(client.getHistory(), []);
        assert.deepStrictEqual(client.getCookies(), {});
    });
});
//# sourceMappingURL=api-client.unit.js.map