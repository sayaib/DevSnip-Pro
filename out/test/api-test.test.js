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
const http = __importStar(require("http"));
const api_test_1 = require("../commands/api-test");
// Mock vscode.ExtensionContext for testing
function createMockContext() {
    const store = {};
    return {
        globalState: {
            get: (key, defaultValue) => (key in store ? store[key] : defaultValue),
            update: async (key, value) => { store[key] = value; },
            keys: () => Object.keys(store)
        }
    };
}
const mockContext = createMockContext();
/** Spins up a lightweight local HTTP server for integration-style tests (no external network). */
function startTestServer(handler) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
        });
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
}
suite('API Test Extension Tests', () => {
    let apiTester;
    setup(() => {
        apiTester = new api_test_1.ApiTester(mockContext);
    });
    teardown(() => {
        // Clean up if needed
    });
    test('ApiTester should initialize correctly', () => {
        assert.ok(apiTester);
        assert.strictEqual(apiTester.getHistory().length, 0);
    });
    test('Should handle history operations correctly', () => {
        // Since addToHistory is private, we'll test through public methods
        const initialCount = apiTester.getHistory().length;
        assert.strictEqual(initialCount, 0);
        apiTester.clearHistory();
        assert.strictEqual(apiTester.getHistory().length, 0);
    });
    test('Should manage cookies correctly', () => {
        const cookies = apiTester.getCookies();
        assert.ok(typeof cookies === 'object');
        apiTester.clearCookies();
        const clearedCookies = apiTester.getCookies();
        assert.ok(typeof clearedCookies === 'object');
    });
    test('Should handle request cancellation', () => {
        // Test that cancellation doesn't throw errors
        apiTester.cancelCurrentRequest();
        assert.ok(true, 'Cancellation should not throw errors');
    });
});
suite('API Tester - cURL Export/Import', () => {
    let apiTester;
    setup(() => {
        apiTester = new api_test_1.ApiTester(createMockContext());
    });
    test('generateCurlCommand produces a valid cURL string with method, headers and body', () => {
        const curl = apiTester.generateCurlCommand({
            method: 'POST',
            url: 'https://api.example.com/users',
            headers: { 'X-Custom': 'value' },
            data: '{"name":"Alice"}',
            authType: 'Bearer',
            authToken: 'secret-token'
        });
        assert.ok(curl.startsWith('curl -X POST'));
        assert.ok(curl.includes("-H 'X-Custom: value'"));
        assert.ok(curl.includes("-H 'Authorization: Bearer secret-token'"));
        assert.ok(curl.includes('-d'));
        assert.ok(curl.includes("'https://api.example.com/users'"));
    });
    test('generateCurlCommand includes Basic auth via -u flag', () => {
        const curl = apiTester.generateCurlCommand({
            method: 'GET',
            url: 'https://api.example.com/secure',
            authType: 'Basic',
            username: 'user',
            password: 'pass'
        });
        assert.ok(curl.includes("-u 'user:pass'"));
    });
    test('generateCurlCommand supports API Key auth in header and query', () => {
        const headerCurl = apiTester.generateCurlCommand({
            method: 'GET',
            url: 'https://api.example.com/data',
            authType: 'ApiKey',
            apiKeyName: 'X-API-Key',
            apiKeyValue: 'abc123',
            apiKeyLocation: 'header'
        });
        assert.ok(headerCurl.includes("-H 'X-API-Key: abc123'"));
        const queryCurl = apiTester.generateCurlCommand({
            method: 'GET',
            url: 'https://api.example.com/data',
            authType: 'ApiKey',
            apiKeyName: 'apiKey',
            apiKeyValue: 'abc123',
            apiKeyLocation: 'query'
        });
        assert.ok(queryCurl.includes('apiKey=abc123'));
    });
    test('parseCurlCommand extracts method, url, headers, body and basic auth', () => {
        const parsed = apiTester.parseCurlCommand(`curl -X POST 'https://api.example.com/login' -H 'Content-Type: application/json' -d '{"user":"bob"}' -u admin:pw123`);
        assert.strictEqual(parsed.method, 'POST');
        assert.strictEqual(parsed.url, 'https://api.example.com/login');
        assert.strictEqual(parsed.headers?.['Content-Type'], 'application/json');
        assert.strictEqual(parsed.data, '{"user":"bob"}');
        assert.strictEqual(parsed.authType, 'Basic');
        assert.strictEqual(parsed.username, 'admin');
        assert.strictEqual(parsed.password, 'pw123');
    });
    test('parseCurlCommand defaults to GET and throws on missing URL', () => {
        const parsed = apiTester.parseCurlCommand(`curl -H 'Accept: application/json' https://api.example.com/ping`);
        assert.strictEqual(parsed.method, 'GET');
        assert.strictEqual(parsed.url, 'https://api.example.com/ping');
        assert.throws(() => apiTester.parseCurlCommand('curl -X GET'), /No URL found/);
        assert.throws(() => apiTester.parseCurlCommand('not a curl command'), /Not a valid cURL command/);
    });
    test('parseCurlCommand + generateCurlCommand round trip preserves core request shape', () => {
        const original = `curl -X PUT 'https://api.example.com/items/1' -H 'X-Token: xyz' -d '{"qty":2}'`;
        const parsed = apiTester.parseCurlCommand(original);
        const regenerated = apiTester.generateCurlCommand({
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers,
            data: parsed.data
        });
        assert.ok(regenerated.includes('-X PUT'));
        assert.ok(regenerated.includes("-H 'X-Token: xyz'"));
        assert.ok(regenerated.includes("'https://api.example.com/items/1'"));
    });
});
suite('API Tester - Body Type Handling (via cURL generation)', () => {
    let apiTester;
    setup(() => { apiTester = new api_test_1.ApiTester(createMockContext()); });
    test('form-urlencoded body type encodes a JSON object as key=value pairs', () => {
        const curl = apiTester.generateCurlCommand({
            method: 'POST',
            url: 'https://api.example.com/form',
            data: '{"username":"neo","password":"matrix"}',
            bodyType: 'form-urlencoded'
        });
        assert.ok(curl.includes('username=neo'));
        assert.ok(curl.includes('password=matrix'));
    });
    test('text body type sends the raw string untouched', () => {
        const curl = apiTester.generateCurlCommand({
            method: 'POST',
            url: 'https://api.example.com/raw',
            data: 'plain raw payload',
            bodyType: 'text'
        });
        assert.ok(curl.includes("-d 'plain raw payload'"));
    });
    test('invalid JSON with explicit json content-type throws a helpful error', () => {
        assert.throws(() => apiTester.generateCurlCommand({
            method: 'POST',
            url: 'https://api.example.com/strict',
            headers: { 'Content-Type': 'application/json' },
            data: '{not valid json',
            bodyType: 'json'
        }), /Invalid JSON in request body/);
    });
});
suite('API Tester - History Export', () => {
    let apiTester;
    setup(() => { apiTester = new api_test_1.ApiTester(createMockContext()); });
    test('exportHistory returns valid, parseable JSON for an empty history', () => {
        const json = apiTester.exportHistory('json');
        const parsed = JSON.parse(json);
        assert.ok(Array.isArray(parsed));
        assert.strictEqual(parsed.length, 0);
    });
    test('exportHistory CSV format includes a header row', () => {
        const csv = apiTester.exportHistory('csv');
        assert.ok(csv.startsWith('id,method,url,status,responseTime,size,attempts,timestamp'));
    });
});
suite('API Tester - makeRequest against a local test server', () => {
    let apiTester;
    let server;
    let baseUrl;
    setup(async () => {
        apiTester = new api_test_1.ApiTester(createMockContext());
    });
    teardown(async () => {
        apiTester.cancelCurrentRequest();
        if (server)
            await new Promise((resolve) => server.close(() => resolve()));
    });
    test('sends Bearer auth header and receives echoed response', async () => {
        ({ server, url: baseUrl } = await startTestServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ auth: req.headers['authorization'] || null }));
        }));
        const result = await apiTester.makeRequest({
            method: 'GET',
            url: baseUrl,
            authType: 'Bearer',
            authToken: 'my-token'
        });
        assert.strictEqual(result.status, 200);
        assert.strictEqual(result.data.auth, 'Bearer my-token');
    });
    test('sends API Key as a custom header when apiKeyLocation is header', async () => {
        ({ server, url: baseUrl } = await startTestServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ key: req.headers['x-api-key'] || null }));
        }));
        const result = await apiTester.makeRequest({
            method: 'GET',
            url: baseUrl,
            authType: 'ApiKey',
            apiKeyName: 'X-API-Key',
            apiKeyValue: 'super-secret',
            apiKeyLocation: 'header'
        });
        assert.strictEqual(result.data.key, 'super-secret');
    });
    test('sends API Key as a query parameter when apiKeyLocation is query', async () => {
        ({ server, url: baseUrl } = await startTestServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ url: req.url }));
        }));
        const result = await apiTester.makeRequest({
            method: 'GET',
            url: baseUrl,
            authType: 'ApiKey',
            apiKeyName: 'apiKey',
            apiKeyValue: 'super-secret',
            apiKeyLocation: 'query'
        });
        assert.ok(result.data.url.includes('apiKey=super-secret'));
    });
    test('retries on a 503 response and eventually succeeds', async () => {
        let hitCount = 0;
        ({ server, url: baseUrl } = await startTestServer((req, res) => {
            hitCount++;
            if (hitCount < 3) {
                res.statusCode = 503;
                res.end('Service Unavailable');
                return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
        }));
        const result = await apiTester.makeRequest({
            method: 'GET',
            url: baseUrl,
            retries: 3,
            retryDelay: 10,
            retryStatusCodes: [503]
        });
        assert.strictEqual(result.status, 200);
        assert.strictEqual(result.attempts, 3);
        assert.strictEqual(hitCount, 3);
    });
    test('does not retry when retries is 0 (default, backward compatible)', async () => {
        let hitCount = 0;
        ({ server, url: baseUrl } = await startTestServer((req, res) => {
            hitCount++;
            res.statusCode = 503;
            res.end('Service Unavailable');
        }));
        const result = await apiTester.makeRequest({ method: 'GET', url: baseUrl });
        assert.strictEqual(result.status, 503);
        assert.strictEqual(hitCount, 1);
    });
    test('sends form-urlencoded body with correct Content-Type', async () => {
        ({ server, url: baseUrl } = await startTestServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ contentType: req.headers['content-type'] || null }));
        }));
        const result = await apiTester.makeRequest({
            method: 'POST',
            url: baseUrl,
            data: '{"a":"1","b":"2"}',
            bodyType: 'form-urlencoded'
        });
        assert.ok(result.data.contentType.includes('application/x-www-form-urlencoded'));
    });
    test('records attempt count and status in history after a failed request', async () => {
        ({ server, url: baseUrl } = await startTestServer((req, res) => {
            res.statusCode = 500;
            res.end('error');
        }));
        const result = await apiTester.makeRequest({ method: 'GET', url: baseUrl });
        assert.strictEqual(result.status, 500);
        const history = apiTester.getHistory();
        assert.strictEqual(history[0].status, 500);
        assert.strictEqual(history[0].attempts, 1);
    });
});
suite('API Test Integration Tests', () => {
    test('Should create webview panel correctly', async () => {
        // This test would require a full VS Code environment
        // For now, we'll just test that the command exists
        assert.ok(true, 'Integration test placeholder');
    });
});
//# sourceMappingURL=api-test.test.js.map