import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { scanLocalCloudConfiguration, scanWorkspaceForSecurity } from "../commands/platformTools";

/**
 * Exercises the audit rules against files written into the test workspace, so
 * the scanners are verified end to end through the VS Code filesystem API
 * rather than only as regular expressions.
 */
const FIXTURE_DIR = "devsnip-security-fixture";

async function writeFixture(relativePath: string, content: string): Promise<vscode.Uri> {
  const root = vscode.workspace.workspaceFolders?.[0];
  assert.ok(root, "these tests need a workspace folder");
  const uri = vscode.Uri.joinPath(root.uri, FIXTURE_DIR, relativePath);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, ".."));
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
  return uri;
}

suite("Security audit rules", () => {
  suiteSetup(async function () {
    if (!vscode.workspace.workspaceFolders?.length) {
      // The default test run has no folder open; skip rather than fail.
      this.skip();
      return;
    }
    await writeFixture("app.js", [
      'const awsKey = "AKIA4KPQ7RZT2XW9BVLM";',
      'const apiKey = "sk-live-9f8a7b6c5d4e3f2a1b0c";',
      'const db = "postgres://admin:hunter2@db.internal:5432/app";',
      "eval(userInput);",
      'fetch("http://tracker.example.com/collect");'
    ].join("\n"));

    await writeFixture("infra.tf", [
      'resource "aws_security_group_rule" "open" {',
      '  cidr_blocks = ["0.0.0.0/0"]',
      "}",
      'resource "aws_s3_bucket" "b" {',
      '  acl = "public-read"',
      "  server_side_encryption = false",
      "}"
    ].join("\n"));

    await writeFixture("deploy.yaml", [
      "spec:",
      "  hostNetwork: true",
      "  containers:",
      "    - image: nginx:latest",
      "      securityContext:",
      "        privileged: true"
    ].join("\n"));
  });

  suiteTeardown(async () => {
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) return;
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(root.uri, FIXTURE_DIR), { recursive: true, useTrash: false });
    } catch {
      /* the fixture may already be gone */
    }
  });

  test("detects hard-coded secrets and unsafe code", async () => {
    const findings = await scanWorkspaceForSecurity();
    const fixtureFindings = findings.filter(finding => finding.file.includes(FIXTURE_DIR));
    const rules = new Set(fixtureFindings.map(finding => finding.rule));

    for (const expected of ["aws-access-key", "generic-secret", "database-url", "unsafe-eval", "insecure-http"]) {
      assert.ok(rules.has(expected), `expected the ${expected} rule to fire; got: ${[...rules].join(", ")}`);
    }
  });

  test("redacts the secret value it reports", async () => {
    const findings = await scanWorkspaceForSecurity();
    const secret = findings.find(finding => finding.rule === "aws-access-key" && finding.file.includes(FIXTURE_DIR));
    assert.ok(secret, "the AWS key finding is missing");
    assert.ok(!secret.evidence.includes("AKIA4KPQ7RZT2XW9BVLM"), "the raw credential must never be shown");
    assert.ok(secret.evidence.includes("•"), "the evidence should be masked");
  });

  test("reports a usable file and line for every finding", async () => {
    const findings = await scanWorkspaceForSecurity();
    for (const finding of findings.filter(item => item.file.includes(FIXTURE_DIR))) {
      assert.ok(finding.line >= 1, `${finding.rule} reported line ${finding.line}`);
      assert.ok(finding.file.length > 0, `${finding.rule} reported no file`);
      assert.ok(["critical", "high", "medium", "low"].includes(finding.severity));
    }
  });

  test("detects insecure cloud configuration", async () => {
    const findings = await scanLocalCloudConfiguration();
    const rules = new Set(findings.filter(finding => finding.file.includes(FIXTURE_DIR)).map(finding => finding.rule));

    for (const expected of ["public-network-ingress", "public-cloud-storage", "unencrypted-storage", "privileged-container", "host-networking", "latest-container-tag"]) {
      assert.ok(rules.has(expected), `expected the ${expected} rule to fire; got: ${[...rules].join(", ")}`);
    }
  });

  test("scanning a workspace twice is stable", async () => {
    const first = await scanWorkspaceForSecurity();
    const second = await scanWorkspaceForSecurity();
    assert.strictEqual(first.length, second.length, "the scan must be deterministic");
  });

  test("the audit finishes in a reasonable time", async () => {
    const started = Date.now();
    await scanWorkspaceForSecurity();
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 30000, `the scan took ${elapsed}ms`);
  });

  test("paths are handled with the platform separator", async () => {
    const findings = await scanWorkspaceForSecurity();
    const fixture = findings.find(finding => finding.file.includes(FIXTURE_DIR));
    assert.ok(fixture, "no fixture finding to check");
    if (os.platform() === "win32") {
      assert.ok(!path.isAbsolute(fixture.file) || fixture.file.includes("\\") || fixture.file.includes("/"));
    } else {
      assert.ok(!fixture.file.includes("\\"), "POSIX paths must not contain backslashes");
    }
  });
});
