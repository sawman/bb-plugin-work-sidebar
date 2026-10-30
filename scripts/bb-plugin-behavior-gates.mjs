import { constants } from "node:fs";
import { copyFile, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";

// Profiles are deliberately explicit. A new Tasks patch/release must opt into a
// reviewed profile; missing/unknown selection cannot silently skip the gate.
const profiles = {
  "tasks-thread-workflow-v1": {
    patchId: "tasks-thread-workflow",
    pluginId: "tasks",
    testSource: "bb-plugins/tasks/thread-workflow.behavior.test.ts.txt",
    testName: "bb-catalog-thread-workflow.test.ts",
    expectedTests: 24,
  },
};

export async function withPatchBehaviorGates({ repoRoot, sourceRoot, version, plan, run, env }, continuePreflight) {
  if (plan.sourceRef !== `desktop-v${version}`) {
    throw new Error(`Behavior gate version mismatch: ${version} / ${plan.sourceRef}`);
  }
  const selections = [];
  for (const entry of plan.patches) {
    const required = entry.pluginId === "tasks" || entry.id === "tasks-thread-workflow";
    const profile = profiles[entry.behaviorGate];
    if (!required && entry.behaviorGate === undefined) continue;
    if (!profile || profile.patchId !== entry.id || profile.pluginId !== entry.pluginId || entry.pluginPath !== "plugins/tasks") {
      throw new Error(`Missing or incompatible mandatory behavior gate for ${version} ${entry.id}`);
    }
    const source = join(repoRoot, profile.testSource);
    // Validate every catalog input before running/copying anything.
    await readFile(source);
    selections.push({ entry, profile, source });
  }
  const temporaryFiles = [];
  try {
    for (const { entry, profile, source } of selections) {
      const pluginRoot = join(sourceRoot, entry.pluginPath);
      const testPath = join(pluginRoot, profile.testName);
      const reportPath = join(sourceRoot, `${entry.id}.behavior-results.json`);
      // Never overwrite source files or trust a stale success report.
      await copyFile(source, testPath, constants.COPYFILE_EXCL);
      temporaryFiles.push(testPath);
      await rm(reportPath, { force: true });
      run("pnpm", [
        "--filter", entry.turboFilter, "exec", "vitest", "run",
        "--no-file-parallelism", profile.testName,
        "--reporter=json", `--outputFile=${reportPath}`,
      ], { cwd: sourceRoot, env });
      const report = JSON.parse(await readFile(reportPath, "utf8"));
      const suites = report.testResults;
      if (report.success !== true || report.numTotalTests !== profile.expectedTests ||
          report.numPassedTests !== profile.expectedTests || report.numFailedTests !== 0 ||
          report.numPendingTests !== 0 || report.numTodoTests !== 0 ||
          !Array.isArray(suites) || suites.length !== 1 || suites[0].status !== "passed" ||
          await realpath(suites[0].name) !== await realpath(testPath)) {
        throw new Error(`Incomplete mandatory behavior results for ${version} ${entry.id}`);
      }
      console.log(`Mandatory ${version} ${entry.id} behavior: ${report.numPassedTests} passed`);
    }
    // All gates run before any artifact is staged, even for other plugins/core.
    // Keep native tests present for the ordinary suite and typecheck as well.
    return await continuePreflight();
  } finally {
    for (const testPath of temporaryFiles) await rm(testPath, { force: true });
  }
}
