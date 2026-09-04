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

async function copyServerArtifacts(from, to) {
  await mkdir(to, { recursive: true });
  for (const file of ["server.js", "server.js.map", "server.meta.json"]) {
    await copyFile(join(from, file), join(to, file));
  }
}

const workspace = await mkdtemp(join(tmpdir(), `bb-plugin-sync-${version}-`));
const sourceRoot = join(workspace, "bb");
const stagingRoot = join(
  process.env.BB_PATCH_STAGING_ROOT ?? join(process.env.HOME ?? "", ".bb/patch-staging"),
  `bb-${version}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
);

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
  for (const entry of plan.patches) {
    if (entry.serverRouteTest === undefined) continue;
    run(join(sourceRoot, "node_modules/.bin/turbo"), [
      "run",
      "typecheck",
      "--filter=@bb/server",
      "--force",
    ], { cwd: sourceRoot });
    run("pnpm", ["--filter", "@bb/server", "exec", "vitest", "run", entry.serverRouteTest], {
      cwd: sourceRoot,
    });
  }
  for (const entry of plan.patches) {
    run(join(sourceRoot, "node_modules/.bin/turbo"), [
      "run",
      "test",
      `--filter=${entry.turboFilter}`,
      "--force",
    ], { cwd: sourceRoot });
    run(join(sourceRoot, "node_modules/.bin/turbo"), [
      "run",
      "typecheck",
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
    await copyServerArtifacts(join(pluginRoot, "dist"), join(stagingRoot, entry.pluginId));
  }

  await writeFile(
    join(stagingRoot, "manifest.json"),
    `${JSON.stringify({ version, sourceRef: plan.sourceRef, sourceCommit: plan.sourceCommit, patches: plan.patches }, null, 2)}\n`,
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
    for (const entry of plan.patches) {
      const target = installedPluginDir(entry.pluginId);
      await copyServerArtifacts(target, join(backupRoot, entry.pluginId));
      await copyServerArtifacts(join(stagingRoot, entry.pluginId), target);
      run("bb", ["plugin", "reload", entry.pluginId]);
    }
    console.log(`Deployed. Previous artifacts backed up at ${backupRoot}`);
  }
} finally {
  if (!keepWorkspace) await rm(workspace, { recursive: true, force: true });
  else console.log(`Kept source workspace at ${workspace}`);
}
