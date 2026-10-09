#!/usr/bin/env node
/**
 * End-to-end analytics verification, run before each release.
 *
 *   node scripts/verify-analytics.js
 *
 * What it does, the way a real user would experience it:
 *  1. Packages DevSnip Pro twice (current version and a higher test version),
 *     both with POSTHOG_ENVIRONMENT=test so every event is tagged
 *     environment=test and excluded from production dashboards.
 *  2. Installs the first package into a brand-new, isolated VS Code profile
 *     (its own user-data and extensions directories, telemetry level "all"),
 *     exactly like a Marketplace install - the extension runs in Production mode.
 *  3. Uses real DevSnip Pro features through a tiny driver extension, waits past
 *     the 30s flush interval, and closes VS Code (exercising the shutdown flush).
 *  4. Installs the higher version into the same profile and runs again, to
 *     verify the update path (same anonymous id, so not counted as a new user).
 *  5. Checks the extension's own logs for failed PostHog requests and errors.
 *  6. Queries PostHog (needs a personal key with query:read) and checks that
 *     every expected event arrived, with only allowed properties.
 *
 * Credentials come from .env.posthog (see .env.posthog.example). Afterwards the
 * production analytics.config.json is restored.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
require("./load-env").loadPostHogEnv();

const ROOT = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const EXTENSION_ID = `${pkg.publisher}.${pkg.name}`;
const [major, minor] = pkg.version.split(".").map(Number);
const NEXT_VERSION = `${major}.${minor}.${9000 + Math.floor(Math.random() * 999)}`;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "devsnip-analytics-e2e-"));
const results = { startedAt: new Date().toISOString(), checks: [] };

function check(name, ok, detail = "") {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

function sh(cmd, args, options = {}) {
  const run = spawnSync(cmd, args, { cwd: options.cwd || ROOT, encoding: "utf8", env: { ...process.env, ...(options.env || {}) }, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${run.stdout}\n${run.stderr}`);
  return run.stdout;
}

function packageVsix(file, version) {
  const args = ["vsce", "package", "--out", file];
  if (version) args.splice(2, 0, version, "--no-update-package-json", "--no-git-tag-version");
  sh("npx", args, { env: { POSTHOG_ENVIRONMENT: "test" } });
  const config = JSON.parse(execFileSync("unzip", ["-p", file, "extension/analytics.config.json"], { encoding: "utf8" }));
  return config;
}

/**
 * The driver: a throwaway extension installed next to DevSnip Pro like any
 * other extension (not a test harness - test mode keeps storage in memory, so
 * an update could not be observed). When DEVSNIP_E2E_OUT is set it uses
 * DevSnip Pro features, waits past the 30s flush interval, writes a report and
 * quits VS Code normally, which runs DevSnip Pro's shutdown flush.
 */
function writeDriver(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: "devsnip-analytics-driver", displayName: "DevSnip analytics e2e driver", description: "Test driver", publisher: "local",
    version: "0.0.1", license: "MIT", engines: { vscode: "^1.93.0" }, main: "./extension.js", activationEvents: ["onStartupFinished"]
  }));
  fs.writeFileSync(path.join(dir, "README.md"), "Test driver for scripts/verify-analytics.js\n");
  fs.writeFileSync(path.join(dir, "LICENSE"), "MIT\n");
  fs.writeFileSync(path.join(dir, "extension.js"), `
const vscode = require("vscode");
const fs = require("fs");
exports.activate = async function () {
  const target = process.env.DEVSNIP_E2E_OUT;
  if (!target) return;
  const out = { commands: [], errors: [] };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    const ext = vscode.extensions.getExtension(${JSON.stringify(EXTENSION_ID)});
    if (!ext) throw new Error("DevSnip Pro is not installed in this profile");
    const t0 = Date.now();
    await ext.activate();
    out.activationMs = Date.now() - t0;
    out.version = ext.packageJSON.version;
    const quick = process.env.DEVSNIP_E2E_MODE === "quick";
    const commands = quick ? ["jsonFormatter"] : ${JSON.stringify([
      "advancedToolsHub", "jsonFormatter", "hashGenerator", "base64Encoder", "regexBuilder", "colorPalette",
      "aiMlHub", "tokenCounter", "ragHub", "bigDataHub", "securityHub", "dependencyManager", "milestoneTracker",
      "jsonFormatter", "hashGenerator"
    ])};
    for (const name of commands) {
      const started = Date.now();
      try {
        await Promise.race([vscode.commands.executeCommand("sayaib.hue-console." + name), sleep(8000).then(() => { throw new Error("timeout"); })]);
        out.commands.push({ id: name, ok: true, ms: Date.now() - started });
      } catch (error) {
        out.commands.push({ id: name, ok: false, error: String((error && error.message) || error) });
      }
      await sleep(400);
    }
    await sleep(quick ? 3000 : 36000);
  } catch (error) {
    out.errors.push(String((error && error.stack) || error));
  }
  fs.writeFileSync(target, JSON.stringify(out, null, 2));
  await vscode.commands.executeCommand("workbench.action.quit");
};
exports.deactivate = () => {};`);
  const vsix = path.join(dir, "driver.vsix");
  sh("npx", ["vsce", "package", "--allow-missing-repository", "--skip-license", "--out", vsix], { cwd: dir });
  return vsix;
}

async function runVsCode(label, vsix, profile, driverVsix, mode = "full") {
  const { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } = require("@vscode/test-electron");
  const cached = path.join(ROOT, ".vscode-test");
  const available = fs.existsSync(cached) ? fs.readdirSync(cached).filter(d => /^vscode-/.test(d)) : [];
  const version = (available.find(d => d.includes(process.arch)) || available[0] || "").replace(/^vscode-(darwin-|linux-|win32-)?(arm64-|x64-)?/, "") || "stable";
  const executable = await downloadAndUnzipVSCode(version);
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable);
  const dirs = [`--user-data-dir=${profile.userData}`, `--extensions-dir=${profile.extensions}`];
  const baseArgs = cliArgs.filter(a => !/^--(user-data|extensions)-dir/.test(a));
  for (const file of [vsix, driverVsix]) sh(cli, [...baseArgs, ...dirs, "--install-extension", file, "--force"]);
  // An update leaves the old version on disk until the next start; finish that
  // cleanup now, as a restart would, so VS Code does not restart the extension host mid-run.
  const obsoleteFile = path.join(profile.extensions, ".obsolete");
  if (fs.existsSync(obsoleteFile)) {
    for (const folder of Object.keys(JSON.parse(fs.readFileSync(obsoleteFile, "utf8")))) fs.rmSync(path.join(profile.extensions, folder), { recursive: true, force: true });
    fs.rmSync(obsoleteFile, { force: true });
  }

  const outFile = path.join(WORK, `${label}.json`);
  const started = Date.now();
  // A normal VS Code launch (no test mode), so storage persists between runs like for a real user.
  const code = await new Promise(resolve => {
    const child = require("child_process").spawn(executable, [profile.workspace, ...dirs, "--disable-gpu", "--skip-welcome", "--skip-release-notes", "--disable-workspace-trust", "--new-window"], {
      env: { ...process.env, DEVSNIP_E2E_OUT: outFile, DEVSNIP_E2E_MODE: mode },
      stdio: "ignore"
    });
    const timer = setTimeout(() => { child.kill(); resolve("timeout"); }, 180000);
    child.on("exit", exitCode => { clearTimeout(timer); resolve(exitCode); });
  });
  if (!fs.existsSync(outFile)) throw new Error(`${label}: VS Code exited (${code}) without a driver report`);
  const report = JSON.parse(fs.readFileSync(outFile, "utf8"));
  report.wallMs = Date.now() - started;
  report.exitCode = code;
  if (report.errors.length) throw new Error(`${label}: driver failed: ${report.errors.join("\n")}`);
  return report;
}

function readLogs(profile) {
  const logsRoot = path.join(profile.userData, "logs");
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); entry.isDirectory() ? walk(full) : files.push(full); } };
  if (fs.existsSync(logsRoot)) walk(logsRoot);
  const analytics = files.filter(f => /DevSnip Pro: Analytics/.test(path.basename(f)) || /Analytics\.log$/.test(f)).map(f => fs.readFileSync(f, "utf8")).join("\n");
  const exthost = files.filter(f => /exthost\.log$/.test(f)).map(f => fs.readFileSync(f, "utf8")).join("\n");
  return { analytics, exthost };
}

async function queryPostHog(sql) {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const project = process.env.POSTHOG_PROJECT_ID;
  const host = (process.env.POSTHOG_APP_HOST || "https://us.posthog.com").replace(/\/+$/, "");
  const response = await fetch(`${host}/api/projects/${project}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    // force_blocking: PostHog caches identical queries, which would hide events still being ingested.
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql }, refresh: "force_blocking" })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`PostHog query failed: HTTP ${response.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function main() {
  if (!process.env.POSTHOG_PROJECT_API_KEY) throw new Error("POSTHOG_PROJECT_API_KEY is not set (.env.posthog).");
  console.log(`Work directory: ${WORK}`);
  const profile = {
    userData: path.join(WORK, "user-data"),
    extensions: path.join(WORK, "extensions"),
    workspace: path.join(WORK, "workspace")
  };
  fs.mkdirSync(path.join(profile.userData, "User"), { recursive: true });
  fs.mkdirSync(profile.workspace, { recursive: true });
  fs.writeFileSync(path.join(profile.workspace, "package.json"), JSON.stringify({ name: "e2e-sample", dependencies: { ms: "^2.0.0" } }));
  fs.writeFileSync(path.join(profile.userData, "User", "settings.json"), JSON.stringify({
    "telemetry.telemetryLevel": "all",
    "devsnip.analytics.debug": true,
    "workbench.startupEditor": "none",
    "security.workspace.trust.enabled": false
  }, null, 2));
  const driver = writeDriver(path.join(WORK, "driver"));

  console.log(`\n== Packaging test builds (${pkg.version} and ${NEXT_VERSION}, environment=test)`);
  const vsixA = path.join(WORK, `devsnip-${pkg.version}.vsix`);
  const vsixB = path.join(WORK, `devsnip-${NEXT_VERSION}.vsix`);
  const configA = packageVsix(vsixA);
  packageVsix(vsixB, NEXT_VERSION);
  check("test build carries the project key, host and environment=test", /^phc_/.test(configA.posthogKey) && configA.environment === "test", `${configA.posthogHost}, environment=${configA.environment}`);

  const since = new Date(Date.now() - 5000).toISOString().replace("T", " ").replace(/\..+$/, "");
  console.log("\n== Run 1: fresh install, using features");
  const run1 = await runVsCode("run1", vsixA, profile, driver);
  console.log("\n== Run 2: update to", NEXT_VERSION);
  const run2 = await runVsCode("run2", vsixB, profile, driver);
  console.log("\n== Run 3: restart (same version) - delivers anything stored at the last shutdown");
  const run3 = await runVsCode("run3", vsixB, profile, driver, "quick");
  results.runs = { run1, run2, run3 };

  const completed1 = run1.commands.filter(c => c.ok).length;
  check("run 1: DevSnip Pro activated from a Marketplace-style install", run1.version === pkg.version, `activate() took ${run1.activationMs} ms`);
  check("run 1: features ran", completed1 >= 10, `${completed1}/${run1.commands.length} commands completed`);
  check("run 2: the updated version is the one running", run2.version === NEXT_VERSION);

  const logs = readLogs(profile);
  fs.writeFileSync(path.join(WORK, "analytics-channel.log"), logs.analytics);
  check("analytics started in production mode with environment=test", /Analytics started \(environment: test/.test(logs.analytics));
  check("no failed PostHog deliveries", !/Delivery failed|answered HTTP/.test(logs.analytics), (logs.analytics.match(/.*(Delivery failed|answered HTTP).*/g) || []).join(" | ").slice(0, 300));
  const extErrors = (logs.exthost.match(/.*\[error\].*/g) || []).filter(line => /hue-console|devsnip|analytics|posthog/i.test(line));
  check("no DevSnip Pro errors in the extension host log", extErrors.length === 0, extErrors.slice(0, 3).join(" | ").slice(0, 400));

  if (!process.env.POSTHOG_PERSONAL_API_KEY || !process.env.POSTHOG_PROJECT_ID) {
    console.log("\nPOSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID not set: skipping the PostHog-side checks.");
  } else {
    console.log("\n== Waiting for PostHog to ingest the events");
    const where = `properties.environment = 'test' AND timestamp >= toDateTime('${since}')`;
    // Which of the commands the driver ran are tools (hubs, search and progress pages are not reported).
    require(path.join(ROOT, "out", "test", "unit", "vscode-stub.js")).installVscodeStub();
    const { toolSection } = require(path.join(ROOT, "out", "analytics", "index.js"));
    const toolsRan = [run1, run2, run3].reduce((sum, run) => sum + run.commands.filter(c => c.ok && toolSection(c.id)).length, 0);
    let rows = [];
    for (let attempt = 0; attempt < 24; attempt++) {
      const data = await queryPostHog(`SELECT event, count() AS n, count(DISTINCT distinct_id) AS ids FROM events WHERE ${where} GROUP BY event ORDER BY event`);
      rows = data.results || [];
      const opened = rows.find(r => r[0] === "tool_opened");
      if (opened && opened[1] >= toolsRan && rows.some(r => r[0] === "tool_used") && rows.some(r => r[0] === "extension_active")) break;
      await new Promise(r => setTimeout(r, 10000));
    }
    const byEvent = Object.fromEntries(rows.map(([event, n, ids]) => [event, { n, ids }]));
    results.posthog = byEvent;
    console.table(byEvent);
    const n = e => (byEvent[e] ? byEvent[e].n : 0);
    // A fresh profile has no older id to merge, so not even the one-time $identify is expected here.
    check("only the three analytics events were sent", Object.keys(byEvent).every(e => ["extension_active", "tool_opened", "tool_used"].includes(e)), Object.keys(byEvent).join(", "));
    check("one extension_active for the day, across install, update and restart", n("extension_active") === 1, `${n("extension_active")}`);
    check("a tool_opened for every tool that ran", n("tool_opened") === toolsRan, `${n("tool_opened")} received, ${toolsRan} tools ran`);
    check("tool_used arrived (the dependency scan)", n("tool_used") >= 1, `${n("tool_used")}`);
    check("one anonymous id across install, update and restart", Object.values(byEvent).every(v => v.ids === 1));
    const ids = await queryPostHog(`SELECT DISTINCT distinct_id FROM events WHERE ${where}`);
    // Per machine: a salted hash of VS Code's machine id, in UUID form (or a random UUID when VS Code has none).
    check("distinct_id is an anonymous UUID-shaped id", (ids.results || []).every(r => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r[0])));
    const top = await queryPostHog(`SELECT properties.tool, properties.section, count() FROM events WHERE ${where} AND event = 'tool_opened' GROUP BY properties.tool, properties.section ORDER BY count() DESC`);
    results.tools = top.results;
    check("tool events name the tool and its section", (top.results || []).every(r => typeof r[0] === "string" && typeof r[1] === "string"));

    // Every property key PostHog stored must be one we send on purpose, or one
    // PostHog adds itself - nothing else (no paths, names, hostnames, emails).
    const keys = await queryPostHog(`SELECT DISTINCT arrayJoin(JSONExtractKeys(properties)) AS k FROM events WHERE ${where} ORDER BY k`);
    const ours = new Set(["distinct_id", "$lib", "extension_version", "environment", "tool", "section"]);
    const stored = (keys.results || []).map(r => r[0]);
    const unexpected = stored.filter(k => !ours.has(k) && !k.startsWith("$"));
    results.storedPropertyKeys = stored;
    check("PostHog stored no unexpected properties", unexpected.length === 0, unexpected.join(", "));
    const valueScan = await queryPostHog(`SELECT count() FROM events WHERE ${where} AND (properties LIKE '%${os.userInfo().username}%' OR properties LIKE '%/Users/%' OR properties LIKE '%\\\\\\\\Users%' OR properties LIKE '%@%.%' OR properties LIKE '%${os.hostname().split(".")[0]}%')`);
    check("no username, home path, hostname or email in any stored event", Number(valueScan.results[0][0]) === 0);
    const geo = await queryPostHog(`SELECT countIf(properties.$geoip_country_code IS NOT NULL), countIf(properties.$ip IS NOT NULL), any(properties.$geoip_country_name) FROM events WHERE ${where}`);
    results.geo = geo.results[0];
    check("PostHog added the country (GeoIP) to the events", Number(geo.results[0][0]) > 0, String(geo.results[0][2] || "none"));
    if (Number(geo.results[0][1]) > 0) console.log("NOTE  PostHog stored $ip for these events. See docs/ANALYTICS.md, \"IP addresses\".");
  }

  const failed = results.checks.filter(c => !c.ok);
  results.summary = `${results.checks.length - failed.length}/${results.checks.length} checks passed`;
  fs.writeFileSync(path.join(WORK, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.summary}. Full results: ${path.join(WORK, "results.json")}`);
  return failed.length;
}

main()
  .then(failures => { process.exitCode = failures ? 1 : 0; })
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    // Leave the repository with the production configuration, not the test one.
    spawnSync("node", [path.join(__dirname, "write-analytics-config.js")], { cwd: ROOT, stdio: "inherit", env: { ...process.env, POSTHOG_ENVIRONMENT: "production" } });
  });
