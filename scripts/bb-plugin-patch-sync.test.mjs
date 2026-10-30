import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(await readFile(join(repoRoot, "bb-plugins/registry.json"), "utf8"));

// Run the actual sync entrypoint. Only external build tools are fixture executables;
// no installed app, network, package manager, or plugin runtime is touched here.
async function fixtureRun(t, { mode = "exit", deploy = false, changePlan } = {}) {
  const root = await mkdtemp(join(tmpdir(), "bb-sync-gate-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  const app = join(root, "app");
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  await cp(join(repoRoot, "scripts"), join(repository, "scripts"), { recursive: true });
  await cp(join(repoRoot, "bb-plugins"), join(repository, "bb-plugins"), { recursive: true });
  const entry = structuredClone(catalog.versions["0.47.1"].patches.find(patch => patch.pluginId === "tasks"));
  const plan = { ...catalog.versions["0.47.1"], patches: [entry] };
  await changePlan?.(entry, plan, repository);
  await writeFile(join(repository, "bb-plugins/registry.json"), JSON.stringify({ versions: { "0.47.1": plan } }));
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ version: "0.47.1" }));
  const tool = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const toolName = path.basename(process.argv[1]);
fs.appendFileSync(process.env.EVENTS, JSON.stringify({toolName,args})+"\\n");
if (toolName === "git" && args[0] === "clone") {
 const source = args.at(-1);
 fs.mkdirSync(path.join(source,"packages/plugin-sdk"), {recursive:true});
 fs.writeFileSync(path.join(source,"packages/plugin-sdk/package.json"), JSON.stringify({version:"0.6.79"}));
 fs.mkdirSync(path.join(source,"node_modules/.bin"), {recursive:true});
 fs.copyFileSync(process.argv[1], path.join(source,"node_modules/.bin/turbo"));
 fs.chmodSync(path.join(source,"node_modules/.bin/turbo"), 0o755);
 fs.mkdirSync(path.join(source,"plugins/tasks"), {recursive:true});
 if (process.env.GATE_MODE === "stale-report") fs.writeFileSync(path.join(source,"tasks-thread-workflow.behavior-results.json"), JSON.stringify({success:true,numTotalTests:24,numPassedTests:24,numPendingTests:0,numTodoTests:0,numFailedTests:0,testResults:[{name:path.join(source,"plugins/tasks/bb-catalog-thread-workflow.test.ts"),status:"passed"}]}));
} else if (toolName === "git" && args[0] === "rev-parse") {
 console.log(process.env.SOURCE_COMMIT);
} else if (args.includes("bb-catalog-thread-workflow.test.ts")) {
 if (process.env.GATE_MODE === "exit") process.exit(42);
 const reportArg = args.find(arg => arg.startsWith("--outputFile="));
 if (!["missing-report", "stale-report"].includes(process.env.GATE_MODE)) {
  if (process.env.GATE_MODE === "corrupt-report") {fs.writeFileSync(reportArg.slice("--outputFile=".length), "invalid json");process.exit(0);}
  const count = process.env.GATE_MODE === "empty-report" ? 0 : 24;
  fs.writeFileSync(reportArg.slice("--outputFile=".length), JSON.stringify({success:true,numTotalTests:count,numPassedTests:count,numPendingTests:process.env.GATE_MODE === "skipped-report" ? 1 : 0,numTodoTests:0,numFailedTests:0,testResults:[{name:path.join(process.cwd(),"plugins/tasks/bb-catalog-thread-workflow.test.ts"),status:"passed"}]}));
 }
} else if (toolName === "target-bb") {
 fs.mkdirSync("dist", {recursive:true});
 fs.writeFileSync("dist/server.meta.json", JSON.stringify({pluginId:"tasks",sdkVersion:"0.6.79",builtWith:{bbVersion:process.env.GATE_MODE === "metadata-mismatch" ? "0.46.1" : "0.47.1",pluginSdkVersion:"0.6.79"}}));
 fs.writeFileSync("dist/server.js", "fixture");
}
`;
  for (const command of ["git", "pnpm", "target-bb", "bb"]) {
    await writeFile(join(bin, command), tool, { mode: 0o755 });
  }
  const outcome = spawnSync(process.execPath, [join(repository, "scripts/bb-plugin-patch-sync.mjs"), ...(deploy ? ["--deploy"] : [])], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root,
      BB_APP_ROOT: app, BB_PATCH_BB_CLI: join(bin, "target-bb"),
      BB_PATCH_STAGING_ROOT: join(root, "stage"), BB_PATCH_BACKUP_ROOT: join(root, "backup"),
      BB_PATCH_SOURCE_ROOT: join(root, "local-source"), SOURCE_COMMIT: mode === "source-mismatch" ? "wrong-commit" : plan.sourceCommit,
      EVENTS: join(root, "events"), GATE_MODE: mode },
  });
  const events = await readFile(join(root, "events"), "utf8").catch(() => "");
  return { ...outcome, events, root, app };
}

for (const deploy of [false, true]) {
  test(`mandatory behavior failure blocks ${deploy ? "deployment" : "staging"}`, async t => {
    const outcome = await fixtureRun(t, { deploy });
    assert.notEqual(outcome.status, 0, outcome.stdout + outcome.stderr);
    assert.match(outcome.events, /bb-catalog-thread-workflow.test.ts/);
    assert.doesNotMatch(outcome.events, /target-bb|reload/);
    await assert.rejects(readFile(join(outcome.app, "server/dist/builtin-plugins/tasks/dist/server.js")), { code: "ENOENT" });
    assert.doesNotMatch(outcome.stdout, /Verified build staged|Deployed/);
    await assert.rejects(readdir(join(outcome.root, "stage")), { code: "ENOENT" });
    await assert.rejects(readdir(join(outcome.root, "backup")), { code: "ENOENT" });
  });
}

for (const mode of ["missing-report", "empty-report", "skipped-report", "corrupt-report", "stale-report"]) {
  test(`${mode} blocks the owning pipeline`, async t => {
    const outcome = await fixtureRun(t, { mode });
    assert.notEqual(outcome.status, 0);
    assert.match(outcome.events, /bb-catalog-thread-workflow.test.ts/);
    assert.doesNotMatch(outcome.events, /target-bb|reload/);
    assert.doesNotMatch(outcome.stdout, /Verified build staged/);
  });
}

for (const [label, mutate] of [
  ["missing selection", entry => { delete entry.behaviorGate; }],
  ["unknown profile", entry => { entry.behaviorGate = "unreviewed"; }],
  ["version mismatch", (_entry, plan) => { plan.sourceRef = "desktop-v0.46.1"; }],
  ["missing native input", async (_entry, _plan, repository) => {
    await rm(join(repository, "bb-plugins/tasks/thread-workflow.behavior.test.ts.txt"));
  }],
]) {
  test(`${label} fails closed before artifact work`, async t => {
    const outcome = await fixtureRun(t, { mode: "pass", changePlan: mutate });
    assert.notEqual(outcome.status, 0, outcome.stdout + outcome.stderr);
    assert.doesNotMatch(outcome.events, /target-bb|reload/);
    assert.doesNotMatch(outcome.stdout, /Verified build staged/);
  });
}

test("successful native results allow normal suites, metadata checks and staging", async t => {
  const outcome = await fixtureRun(t, { mode: "pass" });
  assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
  assert.match(outcome.stdout, /Mandatory 0.47.1 tasks-thread-workflow behavior: 24 passed/);
  assert.match(outcome.events, /target-bb/);
  assert.match(outcome.stdout, /Verified build staged/);
});

test("every cataloged Tasks patch selects the reviewed native profile", () => {
  for (const [version, plan] of Object.entries(catalog.versions)) {
    for (const entry of plan.patches.filter(patch => patch.pluginId === "tasks")) {
      assert.equal(entry.behaviorGate, "tasks-thread-workflow-v1", version);
    }
  }
});

for (const mode of ["source-mismatch", "metadata-mismatch"]) {
  test(`${mode} still blocks staging`, async t => {
    const outcome = await fixtureRun(t, { mode });
    assert.notEqual(outcome.status, 0);
    assert.doesNotMatch(outcome.stdout, /Verified build staged/);
    await assert.rejects(readdir(join(outcome.root, "stage")), { code: "ENOENT" });
  });
}
