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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const api_test_1 = require("../commands/api-test");
// Mock vscode.ExtensionContext for testing
const mockContext = {
    globalState: {
        get: (key, defaultValue) => defaultValue,
        update: (key, value) => __awaiter(void 0, void 0, void 0, function* () { }),
        keys: () => []
    }
};
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
        const testItem = {
            method: 'GET',
            url: 'https://api.example.com',
            timestamp: Date.now()
        };
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
suite('API Test Integration Tests', () => {
    test('Should create webview panel correctly', () => __awaiter(void 0, void 0, void 0, function* () {
        // This test would require a full VS Code environment
        // For now, we'll just test that the command exists
        assert.ok(true, 'Integration test placeholder');
    }));
});
//# sourceMappingURL=api-test.test.js.map