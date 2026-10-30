import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { suite, test } from "./run-unit-tests";
import { getMilestoneTrackerHtml } from "../../commands/milestoneTracker";
import { submitFeedback } from "../../feedback";
import { FEEDBACK_CATEGORIES, FEEDBACK_LIMITS, parseFeedbackConfig, sendFeedback, validateFeedback } from "../../feedback/client";

const VALID = { category: "bug_report", title: "Crash on start", message: "It crashes when I open the panel." };
const CONFIG = { url: "https://example.supabase.co", key: "sb_publishable_abc" };
const META = { extensionVersion: "11.84.0", vscodeVersion: "1.100.0", platform: "darwin" };
const root = path.resolve(__dirname, "../../..");

suite("feedback", () => {
  test("accepts every category and trims the fields", () => {
    for (const { id } of FEEDBACK_CATEGORIES) {
      const result = validateFeedback({ ...VALID, category: id, title: "  Crash  ", email: " " });
      assert.ok(result.ok);
      if (result.ok) {
        assert.strictEqual(result.form.category, id);
        assert.strictEqual(result.form.title, "Crash");
        assert.strictEqual(result.form.email, null);
      }
    }
  });

  test("points at the field that needs fixing", () => {
    const field = (raw: unknown) => { const result = validateFeedback(raw); return result.ok ? "" : result.field; };
    assert.strictEqual(field(null), "category");
    assert.strictEqual(field({ ...VALID, category: "spam" }), "category");
    assert.strictEqual(field({ ...VALID, title: " a " }), "title");
    assert.strictEqual(field({ ...VALID, title: "a".repeat(FEEDBACK_LIMITS.titleMax + 1) }), "title");
    assert.strictEqual(field({ ...VALID, message: "short" }), "message");
    assert.strictEqual(field({ ...VALID, message: "a".repeat(FEEDBACK_LIMITS.messageMax + 1) }), "message");
    assert.strictEqual(field({ ...VALID, email: "not-an-email" }), "email");
    assert.strictEqual(field({ ...VALID, title: 42 }), "title");
  });

  test("counts characters like Postgres and drops what it cannot store", () => {
    assert.strictEqual(validateFeedback({ ...VALID, title: "😀😀" }).ok, false);
    assert.strictEqual(validateFeedback({ ...VALID, title: "😀".repeat(FEEDBACK_LIMITS.titleMax) }).ok, true);
    const result = validateFeedback({ ...VALID, message: "line one\u0000\nline two\u0007" });
    assert.ok(result.ok && result.form.message === "line one\nline two");
    const broken = validateFeedback({ ...VALID, title: "Crash \ud83d here" });
    assert.ok(broken.ok && broken.form.title === "Crash  here");
    const emoji = validateFeedback({ ...VALID, title: "Crash 😀" });
    assert.ok(emoji.ok && emoji.form.title === "Crash 😀");
  });

  test("only accepts a publishable key over https", () => {
    const config = (supabaseUrl: string, supabaseKey: string) => parseFeedbackConfig(JSON.stringify({ supabaseUrl, supabaseKey }));
    assert.deepStrictEqual(config("https://example.supabase.co/", "sb_publishable_abc"), CONFIG);
    assert.strictEqual(config("https://example.supabase.co", "sb_secret_abc"), undefined);
    assert.strictEqual(config("http://example.supabase.co", "sb_publishable_abc"), undefined);
    assert.strictEqual(parseFeedbackConfig("not json"), undefined);
    assert.strictEqual(parseFeedbackConfig(undefined), undefined);
  });

  test("posts one row to the feedback table", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const send = (async (target: string, options: RequestInit) => { url = target; init = options; return { ok: true, status: 201 }; }) as unknown as typeof fetch;
    const checked = validateFeedback({ ...VALID, email: "me@example.com" });
    assert.ok(checked.ok);
    if (!checked.ok) return;
    assert.strictEqual(await sendFeedback(CONFIG, checked.form, META, send), "ok");
    assert.strictEqual(url, "https://example.supabase.co/rest/v1/feedback");
    assert.strictEqual((init?.headers as Record<string, string>).apikey, CONFIG.key);
    assert.deepStrictEqual(JSON.parse(String(init?.body)), {
      category: "bug_report", title: VALID.title, message: VALID.message, email: "me@example.com",
      extension_version: "11.84.0", vscode_version: "1.100.0", platform: "darwin"
    });
  });

  test("reports rejected and failed sends without throwing", async () => {
    const checked = validateFeedback(VALID);
    assert.ok(checked.ok);
    if (!checked.ok) return;
    const log = console.error;
    console.error = () => undefined;
    try {
      const rejected = (async () => ({ ok: false, status: 400 })) as unknown as typeof fetch;
      const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
      const hanging = ((_: string, options: RequestInit) => new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;
      assert.strictEqual(await sendFeedback(CONFIG, checked.form, META, rejected), "rejected");
      assert.strictEqual(await sendFeedback(CONFIG, checked.form, META, offline), "network");
      assert.strictEqual(await sendFeedback(CONFIG, checked.form, META, hanging, 5), "network");
    } finally {
      console.error = log;
    }
  });

  test("submitting checks the form first and explains a build without a backend", async () => {
    const context = {} as vscode.ExtensionContext;
    assert.strictEqual((await submitFeedback(context, { ...VALID, title: "" })).field, "title");
    const result = await submitFeedback(context, VALID);
    assert.strictEqual(result.ok, false);
    assert.ok(result.message.includes("not available"));
  });

  test("the migration matches the form's categories and limits", () => {
    const dir = path.join(root, "supabase", "migrations");
    const sql = fs.readdirSync(dir).map(file => fs.readFileSync(path.join(dir, file), "utf8")).join("\n");
    for (const { id } of FEEDBACK_CATEGORIES) assert.ok(sql.includes(`'${id}'`), id);
    assert.ok(sql.includes(`char_length(title) between ${FEEDBACK_LIMITS.titleMin} and ${FEEDBACK_LIMITS.titleMax}`));
    assert.ok(sql.includes(`char_length(message) between ${FEEDBACK_LIMITS.messageMin} and ${FEEDBACK_LIMITS.messageMax}`));
    assert.ok(sql.includes(`char_length(email) <= ${FEEDBACK_LIMITS.emailMax}`));
    assert.ok(sql.includes("enable row level security"));
    assert.ok(!/grant\s+select/i.test(sql), "the publishable key must never read feedback");
  });

  test("the page header offers the form beside Spend points", () => {
    const html = getMilestoneTrackerHtml("vscode-resource:", "tracker.js", "");
    const script = fs.readFileSync(path.join(root, "media", "milestone-tracker.js"), "utf8");
    assert.ok(html.indexOf('id="feedbackBtn"') > 0 && html.indexOf('id="feedbackBtn"') < html.indexOf('id="spendBtn"'));
    assert.ok(script.includes("getElementById('feedbackBtn').addEventListener('click'"));
    assert.ok(script.includes("command: 'submitFeedback'"));
  });
});
