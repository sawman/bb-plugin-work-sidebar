import { execFileSync } from "node:child_process";
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(
  await readFile(join(repoRoot, "bb-plugins/registry.json"), "utf8"),
);
const args = new Set(process.argv.slice(2));
const deploy = args.has("--deploy");
const keepWorkspace = args.has("--keep-workspace");
const appRoot = process.env.BB_APP_ROOT ??
  "/Applications/bb.app/Contents/Resources/app.asar.unpacked/node_modules/bb-app";
const appPackage = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
const version = appPackage.version;
const plan = registry.versions[version];

if (plan === undefined) {
  throw new Error(
    `No catalog entry for installed BB ${version}. Add its source tag and rebase each patch before syncing.`,
  );
}

const coreArtifacts = [
  ...new Map(
    plan.patches.flatMap((entry) =>
      (entry.coreArtifacts ?? []).map((artifact) => [
        artifact.targetPath,
        artifact,
      ]),
    ),
  ).values(),
];
const coreTests = plan.patches.flatMap((entry) => entry.coreTests ?? []);

function run(command, commandArgs, options = {}) {
  console.log(`$ ${[command, ...commandArgs].join(" ")}`);
  execFileSync(command, commandArgs, { stdio: "inherit", ...options });
}

function sourcePatch(entry) {
  return join(repoRoot, entry.sourcePatch);
}

function installedPluginDir(pluginId) {
  return join(appRoot, "server/dist/builtin-plugins", pluginId, "dist");
}

const standaloneBbEnvironment = { ...process.env };
delete standaloneBbEnvironment.BB_CLI;

const pluginArtifactNames = [
  "server.js",
  "server.js.map",
  "server.meta.json",
  "app.js",
  "app.css",
  "app.meta.json",
];

async function copyPluginArtifacts(from, to) {
  await mkdir(to, { recursive: true });
  for (const file of pluginArtifactNames) {
    try {
      await copyFile(join(from, file), join(to, file));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function copyCoreArtifact(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

const workspace = await mkdtemp(join(tmpdir(), `bb-plugin-sync-${version}-`));
const sourceRoot = join(workspace, "bb");
const stagingRoot = join(
  process.env.BB_PATCH_STAGING_ROOT ?? join(process.env.HOME ?? "", ".bb/patch-staging"),
  `bb-${version}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
);

// Node 25 starts without a browser localStorage implementation unless this is
// supplied. Official plugin UI suites share that storage and are racy under
// file parallelism, so every cataloged plugin suite is isolated and serial.
const pluginTestEnvironment = {
  ...standaloneBbEnvironment,
  NODE_OPTIONS: [
    standaloneBbEnvironment.NODE_OPTIONS,
    `--localstorage-file=${join(workspace, "plugin-tests.localstorage.json")}`,
  ].filter(Boolean).join(" "),
};

try {
  run("git", ["clone", "--depth", "1", "--branch", plan.sourceRef, registry.coreRepository, sourceRoot]);
  const actualCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
  }).trim();
  if (actualCommit !== plan.sourceCommit) {
    throw new Error(
      `Source tag ${plan.sourceRef} resolved to ${actualCommit}, expected ${plan.sourceCommit}. Refusing to build.`,
    );
  }

  for (const entry of plan.patches) {
    run("git", ["apply", "--check", sourcePatch(entry)], { cwd: sourceRoot });
  }
  for (const entry of plan.patches) {
    run("git", ["apply", sourcePatch(entry)], { cwd: sourceRoot });
  }
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: sourceRoot });
  if (coreArtifacts.length > 0) {
    run(join(sourceRoot, "node_modules/.bin/turbo"), [
      "run",
      "build",
      "--filter=@bb/server",
      "--force",
    ], { cwd: sourceRoot });
    for (const artifact of coreArtifacts) {
      await copyCoreArtifact(
        join(sourceRoot, artifact.sourcePath),
        join(stagingRoot, "core", artifact.targetPath),
      );
    }
  }

  if (coreTests.length > 0) {
    run(join(sourceRoot, "node_modules/.bin/turbo"), [
      "run",
      "typecheck",
      "--filter=@bb/server",
      "--force",
    ], { cwd: sourceRoot });
    run("pnpm", [
      "--filter",
      "@bb/server",
      "exec",
      "vitest",
      "run",
      "--no-file-parallelism",
      ...coreTests,
    ], {
      cwd: sourceRoot,
    });
  }
  for (const entry of plan.patches) {
    run("pnpm", [
      "--filter",
      entry.turboFilter,
      "exec",
      "vitest",
      "run",
      "--no-file-parallelism",
    ], { cwd: sourceRoot, env: pluginTestEnvironment });
    run(join(sourceRoot, "node_modules/.bin/turbo"), [
      "run",
      "typecheck",
      `--filter=${entry.turboFilter}`,
      "--force",
    ], { cwd: sourceRoot });
    // Some official plugins import the SDK runtime rather than vendoring its
    // declarations. Build their dependency closure before the standalone CLI
    // build so module resolution tests the artifact we will actually stage.
    run(join(sourceRoot, "node_modules/.bin/turbo"), [
      "run",
      "build",
      `--filter=${entry.turboFilter}`,
      "--force",
    ], { cwd: sourceRoot });
    const pluginRoot = join(sourceRoot, entry.pluginPath);
    run("bb", ["plugin", "build", "."], {
      cwd: pluginRoot,
      env: standaloneBbEnvironment,
    });
    const metadata = JSON.parse(await readFile(join(pluginRoot, "dist/server.meta.json"), "utf8"));
    if (metadata.pluginId !== entry.pluginId || metadata.builtWith?.bbVersion !== version) {
      throw new Error(`Unexpected ${entry.pluginId} build metadata.`);
    }
    await copyPluginArtifacts(join(pluginRoot, "dist"), join(stagingRoot, entry.pluginId));
  }

  await writeFile(
    join(stagingRoot, "manifest.json"),
    `${JSON.stringify({ version, sourceRef: plan.sourceRef, sourceCommit: plan.sourceCommit, patches: plan.patches, coreArtifacts }, null, 2)}\n`,
  );
  console.log(`Verified build staged at ${stagingRoot}`);

  if (!deploy) {
    console.log("Not deployed. Re-run with --deploy after reviewing the staged artifacts.");
    process.exitCode = 0;
  } else {
    const backupRoot = join(
      process.env.BB_PATCH_BACKUP_ROOT ?? join(process.env.HOME ?? "", ".bb/patch-backups"),
      `bb-${version}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
    );
    for (const artifact of coreArtifacts) {
      const target = join(appRoot, artifact.targetPath);
      await copyCoreArtifact(target, join(backupRoot, "core", artifact.targetPath));
      await copyCoreArtifact(
        join(stagingRoot, "core", artifact.targetPath),
        target,
      );
    }
    for (const entry of plan.patches) {
      const target = installedPluginDir(entry.pluginId);
      await copyPluginArtifacts(target, join(backupRoot, entry.pluginId));
      await copyPluginArtifacts(join(stagingRoot, entry.pluginId), target);
      run("bb", ["plugin", "reload", entry.pluginId]);
    }
    console.log(`Deployed. Previous artifacts backed up at ${backupRoot}`);
    if (coreArtifacts.length > 0) {
      console.log("Restart BB before relying on deployed core artifacts.");
    }
  }
} finally {
  if (!keepWorkspace) await rm(workspace, { recursive: true, force: true });
  else console.log(`Kept source workspace at ${workspace}`);
}
