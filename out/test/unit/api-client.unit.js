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
const collections_1 = require("../../services/collections");
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
(0, run_unit_tests_1.suite)("REST client errors and environments", () => {
    (0, run_unit_tests_1.test)("names an undefined base-URL variable instead of a generic format error", async () => {
        const client = tester();
        assert.throws(() => client.generateCurlCommand({ method: "GET", url: "{{baseUrl}}/users" }), /\{\{baseUrl\}\} is used but no environment is selected/);
        await client.saveEnvironment({ name: "dev", variables: {} });
        await client.setActiveEnvironment(0);
        assert.throws(() => client.generateCurlCommand({ method: "GET", url: "{{baseUrl}}/users" }), /\{\{baseUrl\}\} is not defined in the active environment "dev"/);
    });
    (0, run_unit_tests_1.test)("transport errors are explained with a fix and where to make it", () => {
        const dns = (0, api_test_1.describeRequestError)({ message: "getaddrinfo ENOTFOUND api.nope.test", code: "ENOTFOUND" });
        assert.strictEqual(dns.title, "Could not find the server");
        assert.strictEqual(dns.action, "url");
        const refused = (0, api_test_1.describeRequestError)({ message: "connect ECONNREFUSED 127.0.0.1:3000", code: "ECONNREFUSED" });
        assert.strictEqual(refused.title, "Connection refused");
        const timeout = (0, api_test_1.describeRequestError)({ message: "timeout of 5000ms exceeded", code: "ECONNABORTED" }, 5000);
        assert.strictEqual(timeout.title, "The request timed out after 5 s");
        assert.strictEqual(timeout.action, "settings");
        const cert = (0, api_test_1.describeRequestError)({ message: "self-signed certificate", code: "DEPTH_ZERO_SELF_SIGNED_CERT" });
        assert.strictEqual(cert.action, "settings");
        assert.strictEqual((0, api_test_1.describeRequestError)({ message: "Invalid JSON in request body" }).action, "body");
        assert.strictEqual((0, api_test_1.describeRequestError)({ message: "Invalid URL format: {{x}} is not defined in the active environment \"dev\"" }).action, "env");
        assert.ok((0, api_test_1.describeRequestError)(undefined).hint.length > 0, "an unknown failure still gets a hint");
    });
    (0, run_unit_tests_1.test)("renaming an environment keeps its place, so it stays active", async () => {
        const client = tester();
        await client.saveEnvironment({ name: "dev", variables: { a: "1" } });
        await client.saveEnvironment({ name: "prod", variables: {} });
        await client.setActiveEnvironment(0);
        await client.saveEnvironment({ name: "development", variables: { a: "2" } }, "dev");
        assert.deepStrictEqual(client.getEnvironments().map(e => e.name), ["development", "prod"]);
        assert.strictEqual(client.getActiveEnvironmentIndex(), 0);
        assert.strictEqual(client.resolveVariables("{{a}}"), "2");
        await assert.rejects(() => client.saveEnvironment({ name: "  ", variables: {} }), /needs a name/);
    });
});
(0, run_unit_tests_1.suite)("REST client history snapshots", () => {
    // Private, but it decides what is written to disk, so it is pinned here.
    const snapshot = (request) => api_test_1.ApiTester.historySnapshot({ method: "GET", url: "https://example.com/", ...request });
    (0, run_unit_tests_1.test)("literal credentials are dropped, variable references are kept", () => {
        const snap = snapshot({
            headers: {
                Accept: "application/json",
                Authorization: "Bearer real-secret-token",
                "X-Api-Key": "{{apiKey}}",
                Cookie: "sid=abc"
            }
        });
        assert.deepStrictEqual(snap.headers, { Accept: "application/json", "X-Api-Key": "{{apiKey}}" });
        assert.strictEqual(snapshot({ headers: { Authorization: "Bearer {{token}}" } }).headers.Authorization, "Bearer {{token}}");
    });
    (0, run_unit_tests_1.test)("a templated URL keeps its variables but not a literal secret", () => {
        const snap = snapshot({ url: "{{baseUrl}}/items?api_key=hunter2&token={{token}}&page=2" });
        assert.strictEqual(snap.url, "{{baseUrl}}/items?api_key=[redacted]&token={{token}}&page=2");
        assert.strictEqual(snapshot({ url: "https://example.com/x" }).url, undefined, "plain URLs are already stored redacted");
    });
    (0, run_unit_tests_1.test)("large bodies are not kept, and exports leave the snapshot out", () => {
        assert.strictEqual(snapshot({ data: "x".repeat(20001) }).data, undefined);
        assert.strictEqual(snapshot({ data: "{\"a\":1}" }).data, "{\"a\":1}");
        const client = tester();
        client.history = [{ id: "1", url: "https://e.com/", method: "GET", timestamp: 0, request: { data: "secret body" } }];
        assert.ok(!client.exportHistory("json").includes("secret body"));
        assert.strictEqual(client.getAllHistory().length, 1);
    });
});
(0, run_unit_tests_1.suite)("saved requests", () => {
    (0, run_unit_tests_1.test)("auth keeps names and variable references, never typed secrets", () => {
        const saved = (0, collections_1.sanitiseRequest)({
            name: "Login",
            url: "https://example.com/login",
            authType: "Bearer",
            auth: { token: "real-token", password: "{{password}}", keyValue: " {{apiKey}} ", keyName: "X-Key", keyLocation: "query", username: "ada" }
        });
        assert.deepStrictEqual(saved?.auth, { keyName: "X-Key", username: "ada", keyLocation: "query", password: "{{password}}", keyValue: "{{apiKey}}" });
    });
    (0, run_unit_tests_1.test)("GraphQL requests keep their query; REST requests carry no GraphQL fields", () => {
        const gql = (0, collections_1.sanitiseRequest)({
            name: "Users", url: "https://example.com/graphql", requestType: "graphql",
            graphql: { query: "{ users { id } }", variables: "{}", operationName: "Users" }
        });
        assert.strictEqual(gql?.requestType, "graphql");
        assert.strictEqual(gql?.graphql?.query, "{ users { id } }");
        const rest = (0, collections_1.sanitiseRequest)({ name: "Users", url: "https://example.com/users", graphql: { query: "ignored" } });
        assert.strictEqual(rest?.requestType, undefined);
        assert.strictEqual(rest?.graphql, undefined);
    });
});
//# sourceMappingURL=api-client.unit.js.map