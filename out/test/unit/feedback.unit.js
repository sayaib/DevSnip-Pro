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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const run_unit_tests_1 = require("./run-unit-tests");
const milestoneTracker_1 = require("../../commands/milestoneTracker");
const feedback_1 = require("../../feedback");
const client_1 = require("../../feedback/client");
const VALID = { category: "bug_report", title: "Crash on start", message: "It crashes when I open the panel." };
const CONFIG = { url: "https://example.supabase.co", key: "sb_publishable_abc" };
const META = { extensionVersion: "11.84.0", vscodeVersion: "1.100.0", platform: "darwin" };
const root = path.resolve(__dirname, "../../..");
(0, run_unit_tests_1.suite)("feedback", () => {
    (0, run_unit_tests_1.test)("accepts every category and trims the fields", () => {
        for (const { id } of client_1.FEEDBACK_CATEGORIES) {
            const result = (0, client_1.validateFeedback)({ ...VALID, category: id, title: "  Crash  ", email: " " });
            assert.ok(result.ok);
            if (result.ok) {
                assert.strictEqual(result.form.category, id);
                assert.strictEqual(result.form.title, "Crash");
                assert.strictEqual(result.form.email, null);
            }
        }
    });
    (0, run_unit_tests_1.test)("points at the field that needs fixing", () => {
        const field = (raw) => { const result = (0, client_1.validateFeedback)(raw); return result.ok ? "" : result.field; };
        assert.strictEqual(field(null), "category");
        assert.strictEqual(field({ ...VALID, category: "spam" }), "category");
        assert.strictEqual(field({ ...VALID, title: " a " }), "title");
        assert.strictEqual(field({ ...VALID, title: "a".repeat(client_1.FEEDBACK_LIMITS.titleMax + 1) }), "title");
        assert.strictEqual(field({ ...VALID, message: "short" }), "message");
        assert.strictEqual(field({ ...VALID, message: "a".repeat(client_1.FEEDBACK_LIMITS.messageMax + 1) }), "message");
        assert.strictEqual(field({ ...VALID, email: "not-an-email" }), "email");
        assert.strictEqual(field({ ...VALID, title: 42 }), "title");
    });
    (0, run_unit_tests_1.test)("counts characters like Postgres and drops what it cannot store", () => {
        assert.strictEqual((0, client_1.validateFeedback)({ ...VALID, title: "😀😀" }).ok, false);
        assert.strictEqual((0, client_1.validateFeedback)({ ...VALID, title: "😀".repeat(client_1.FEEDBACK_LIMITS.titleMax) }).ok, true);
        const result = (0, client_1.validateFeedback)({ ...VALID, message: "line one\u0000\nline two\u0007" });
        assert.ok(result.ok && result.form.message === "line one\nline two");
        const broken = (0, client_1.validateFeedback)({ ...VALID, title: "Crash \ud83d here" });
        assert.ok(broken.ok && broken.form.title === "Crash  here");
        const emoji = (0, client_1.validateFeedback)({ ...VALID, title: "Crash 😀" });
        assert.ok(emoji.ok && emoji.form.title === "Crash 😀");
    });
    (0, run_unit_tests_1.test)("only accepts a publishable key over https", () => {
        const config = (supabaseUrl, supabaseKey) => (0, client_1.parseFeedbackConfig)(JSON.stringify({ supabaseUrl, supabaseKey }));
        assert.deepStrictEqual(config("https://example.supabase.co/", "sb_publishable_abc"), CONFIG);
        assert.strictEqual(config("https://example.supabase.co", "sb_secret_abc"), undefined);
        assert.strictEqual(config("http://example.supabase.co", "sb_publishable_abc"), undefined);
        assert.strictEqual((0, client_1.parseFeedbackConfig)("not json"), undefined);
        assert.strictEqual((0, client_1.parseFeedbackConfig)(undefined), undefined);
    });
    (0, run_unit_tests_1.test)("posts one row to the feedback table", async () => {
        let url = "";
        let init;
        const send = (async (target, options) => { url = target; init = options; return { ok: true, status: 201 }; });
        const checked = (0, client_1.validateFeedback)({ ...VALID, email: "me@example.com" });
        assert.ok(checked.ok);
        if (!checked.ok)
            return;
        assert.strictEqual(await (0, client_1.sendFeedback)(CONFIG, checked.form, META, send), "ok");
        assert.strictEqual(url, "https://example.supabase.co/rest/v1/feedback");
        assert.strictEqual((init?.headers).apikey, CONFIG.key);
        assert.deepStrictEqual(JSON.parse(String(init?.body)), {
            category: "bug_report", title: VALID.title, message: VALID.message, email: "me@example.com",
            extension_version: "11.84.0", vscode_version: "1.100.0", platform: "darwin"
        });
    });
    (0, run_unit_tests_1.test)("reports rejected and failed sends without throwing", async () => {
        const checked = (0, client_1.validateFeedback)(VALID);
        assert.ok(checked.ok);
        if (!checked.ok)
            return;
        const log = console.error;
        console.error = () => undefined;
        try {
            const rejected = (async () => ({ ok: false, status: 400 }));
            const offline = (async () => { throw new Error("offline"); });
            const hanging = ((_, options) => new Promise((_resolve, reject) => {
                options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            }));
            assert.strictEqual(await (0, client_1.sendFeedback)(CONFIG, checked.form, META, rejected), "rejected");
            assert.strictEqual(await (0, client_1.sendFeedback)(CONFIG, checked.form, META, offline), "network");
            assert.strictEqual(await (0, client_1.sendFeedback)(CONFIG, checked.form, META, hanging, 5), "network");
        }
        finally {
            console.error = log;
        }
    });
    (0, run_unit_tests_1.test)("submitting checks the form first and explains a build without a backend", async () => {
        const context = {};
        assert.strictEqual((await (0, feedback_1.submitFeedback)(context, { ...VALID, title: "" })).field, "title");
        const result = await (0, feedback_1.submitFeedback)(context, VALID);
        assert.strictEqual(result.ok, false);
        assert.ok(result.message.includes("not available"));
    });
    (0, run_unit_tests_1.test)("the migration matches the form's categories and limits", () => {
        const dir = path.join(root, "supabase", "migrations");
        const sql = fs.readdirSync(dir).map(file => fs.readFileSync(path.join(dir, file), "utf8")).join("\n");
        for (const { id } of client_1.FEEDBACK_CATEGORIES)
            assert.ok(sql.includes(`'${id}'`), id);
        assert.ok(sql.includes(`char_length(title) between ${client_1.FEEDBACK_LIMITS.titleMin} and ${client_1.FEEDBACK_LIMITS.titleMax}`));
        assert.ok(sql.includes(`char_length(message) between ${client_1.FEEDBACK_LIMITS.messageMin} and ${client_1.FEEDBACK_LIMITS.messageMax}`));
        assert.ok(sql.includes(`char_length(email) <= ${client_1.FEEDBACK_LIMITS.emailMax}`));
        assert.ok(sql.includes("enable row level security"));
        assert.ok(!/grant\s+select/i.test(sql), "the publishable key must never read feedback");
    });
    (0, run_unit_tests_1.test)("the page header offers the form beside Spend points", () => {
        const html = (0, milestoneTracker_1.getMilestoneTrackerHtml)("vscode-resource:", "tracker.js", "");
        const script = fs.readFileSync(path.join(root, "media", "milestone-tracker.js"), "utf8");
        assert.ok(html.indexOf('id="feedbackBtn"') > 0 && html.indexOf('id="feedbackBtn"') < html.indexOf('id="spendBtn"'));
        assert.ok(script.includes("getElementById('feedbackBtn').addEventListener('click'"));
        assert.ok(script.includes("command: 'submitFeedback'"));
    });
});
//# sourceMappingURL=feedback.unit.js.map