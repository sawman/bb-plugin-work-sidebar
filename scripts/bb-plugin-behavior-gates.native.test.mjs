// Opt-in focused acceptance against a disposable existing build workspace.
// This uses the SAME required pre-staging boundary called by sync; it does not
// install, build artifacts, or invoke sync's historical deployment path.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { withPatchBehaviorGates } from "./bb-plugin-behavior-gates.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.env.BB_PATCH_BEHAVIOR_TEST_SOURCE;
assert.ok(sourceRoot, "Set BB_PATCH_BEHAVIOR_TEST_SOURCE to a DISPOSABLE patched 0.47.1 build workspace");
assert.equal(await readFile(join(sourceRoot, ".bb-catalog-disposable"), "utf8"), "BBPLUG-434 disposable\n",
  "Create the disposable-workspace marker only in a private copy, never in pristine source");
const logRoot = process.env.BB_PATCH_BEHAVIOR_TEST_LOG_ROOT;
async function resultReport(label) {
  const reportPath = join(sourceRoot, "tasks-thread-workflow.behavior-results.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (logRoot) {
    await mkdir(logRoot, { recursive: true });
    await copyFile(reportPath, join(logRoot, `${label}.json`));
  }
  return report;
}
async function expectNativeFailure(label, failedTitle) {
  let continued = false;
  await assert.rejects(withPatchBehaviorGates(gateOptions, async () => { continued = true; }), error => error.status === 1);
  assert.equal(continued, false);
  const report = await resultReport(label);
  assert.equal(report.success, false);
  assert.ok(report.numFailedTests > 0);
  const failures = report.testResults.flatMap(suite => suite.assertionResults).filter(result => result.status === "failed");
  assert.ok(failures.some(result => result.fullName.includes(failedTitle)), JSON.stringify(failures));
  console.log(`${label}: ${report.numFailedTests} real native failures; staging/deployment continuation was not entered`);
}
const catalog = JSON.parse(await readFile(join(repoRoot, "bb-plugins/registry.json"), "utf8"));
const plan = catalog.versions["0.47.1"];
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: sourceRoot, encoding: "utf8" }).trim(), plan.sourceCommit);
const env = { ...process.env, NODE_OPTIONS: `--localstorage-file=${join(sourceRoot, "catalog-native.localstorage")}` };
delete env.BB_CLI;
const run = (command, args, options) => execFileSync(command, args, { stdio: "inherit", ...options });
const gateOptions = { repoRoot, sourceRoot, version: "0.47.1", plan, run, env };

await test("actual patched 0.47.1 passes the mandatory pre-staging boundary", async () => {
  let continued = false;
  await withPatchBehaviorGates(gateOptions, async () => { continued = true; });
  assert.equal(continued, true);
  await resultReport("native-patched");
});

await test("removing the Tasks patch fails the mandatory boundary before staging/deployment", async () => {
  const patchPath = join(repoRoot, "bb-plugins/tasks/thread-workflow.patch");
  execFileSync("git", ["apply", "--reverse", "--check", patchPath], { cwd: sourceRoot });
  execFileSync("git", ["apply", "--reverse", patchPath], { cwd: sourceRoot });
  try {
    await expectNativeFailure("native-without-patch", "defaults to all four pending");
  } finally {
    execFileSync("git", ["apply", patchPath], { cwd: sourceRoot });
  }
});

await test("losing CLI caller forwarding alone fails the mandatory boundary", async () => {
  const cliPath = join(sourceRoot, "plugins/tasks/cli/index.ts");
  const original = await readFile(cliPath, "utf8");
  const broken = original.replace("{ parentThreadId: ctx.threadId }", "{}");
  assert.notEqual(broken, original, "Mutation must change production forwarding");
  await writeFile(cliPath, broken);
  try {
    await expectNativeFailure("native-without-parent", "forwards the CLI caller");
  } finally {
    await writeFile(cliPath, original);
  }
});

await test("restored patched behavior is green after both failure proofs", async () => {
  let continued = false;
  await withPatchBehaviorGates(gateOptions, async () => { continued = true; });
  assert.equal(continued, true);
  await resultReport("native-restored");
});
