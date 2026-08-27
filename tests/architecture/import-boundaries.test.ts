import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { assertBrowserRuntimeBoundary } from "./import-graph.js";
import { productionSourcePaths } from "./production-source-paths.js";

const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../../..");

function physicalLines(path: string): number {
  return readFileSync(resolve(repositoryRoot, path), "utf8").split("\n").length - 1;
}

function longestPhysicalLine(path: string): number {
  return Math.max(...readFileSync(resolve(repositoryRoot, path), "utf8").split("\n").map((line) => line.length));
}

const registrationBudgets: Record<string, { lines: number; declarations: number }> = {
  "features/changes/server-registration.ts": { lines: 160, declarations: 6 },
  // Registration wires feature-owned services. GitHub command, stack
  // enrichment, and authored-list polling stay below this adapter.
  "features/pull-requests/server-registration.ts": { lines: 80, declarations: 2 },
  "features/tasks/server-registration.ts": { lines: 80, declarations: 3 },
  "features/threads/server-registration.ts": { lines: 90, declarations: 4 },
  "features/tracker/server-registration.ts": { lines: 70, declarations: 4 },
  "features/work-context/server-registration.ts": { lines: 300, declarations: 8 },
};

const composedServerLineCapPaths = [
  "features/pull-requests/server-stack.ts",
  "features/pull-requests/server-thread-stack.ts",
  "features/tasks/server-tool-registration.ts",
  "features/tasks/server-work-bindings.ts",
] as const;

function compositionImplementationPaths(): string[] {
  const prefix = `${repositoryRoot}/`;
  return productionSourcePaths(repositoryRoot)
    .filter((path) => path.endsWith("/server-registration.ts"))
    .map((path) => path.slice(prefix.length))
    .sort();
}

function foreignFeatureImports(path: string): string[] {
  const ownFeature = path.split("/")[1];
  const permittedBindingSeam = [
    "features/tasks/server-model.ts",
    "features/tasks/server-work-bindings.ts",
  ].includes(path);
  return [...readFileSync(resolve(repositoryRoot, path), "utf8").matchAll(/from\s+["']\.\.\/([^/]+)/g)]
    .map((match) => match[1])
    .filter((feature) => ["changes", "pull-requests", "tasks", "threads", "tracker", "work-context"].includes(feature))
    .filter((feature) => feature !== ownFeature)
    .filter((feature) => !(permittedBindingSeam && feature === "work-context"));
}

function topLevelImplementationDeclarations(path: string): number {
  const source = ts.createSourceFile(path, readFileSync(resolve(repositoryRoot, path), "utf8"), ts.ScriptTarget.Latest, true);
  return source.statements.filter((statement) => {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return false;
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some((declaration) => declaration.initializer !== undefined);
    return ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement);
  }).length;
}

describe("R16 composition boundaries", () => {
  it("keeps browser runtime imports out of server-owned feature adapters", () => {
    assertBrowserRuntimeBoundary(resolve(repositoryRoot, "app.tsx"));
  });

  it("requires server.ts to be a real registration/composition boundary", () => {
    // A server entry may compose factories and register handlers, but feature
    // workflows belong below their owning feature modules. This intentionally
    // rejects the former 1,586-line entry instead of ratifying it with slack.
    expect(physicalLines("app.tsx")).toBeLessThanOrEqual(650);
    // The entrypoint is explicit handler composition, not a feature workflow.
    // 110 permits readable ordered RPC wiring while still rejecting the prior
    // 1,586-line ratification and near-term feature implementation growth.
    expect(physicalLines("server.ts")).toBeLessThanOrEqual(110);
    expect(longestPhysicalLine("server.ts")).toBeLessThanOrEqual(160);
    expect(physicalLines("contracts.ts")).toBeLessThanOrEqual(12);
    expect(physicalLines("contracts.schemas.ts")).toBeLessThanOrEqual(250);
    // The R15 entrypoints had 37 app and 58 server top-level implementation
    // declarations. R16 composes explicit slice factories instead: a new
    // feature implementation must live below its owner, not be hidden by
    // reformatting this entrypoint.
    expect(topLevelImplementationDeclarations("app.tsx")).toBeLessThanOrEqual(30);
    expect(topLevelImplementationDeclarations("server.ts")).toBeLessThanOrEqual(4);
    expect(compositionImplementationPaths()).toEqual(Object.keys(registrationBudgets).sort());
    expect(productionSourcePaths(repositoryRoot)).not.toContain(
      resolve(repositoryRoot, "features/server-registration.ts"),
    );
    for (const path of compositionImplementationPaths()) {
      const budget = registrationBudgets[path];
      if (!budget) throw new Error(`unexpected feature registration boundary: ${path}`);
      // Each ceiling is a ratchet for a feature adapter. Domain services may be
      // substantive, but a server-registration file only composes them.
      expect(physicalLines(path), `${path} cannot become a renamed aggregator`).toBeLessThanOrEqual(budget.lines);
      expect(longestPhysicalLine(path), `${path} must keep implementation lines reviewable`).toBeLessThanOrEqual(240);
      expect(topLevelImplementationDeclarations(path), `${path} must keep implementation inside its feature services`).toBeLessThanOrEqual(budget.declarations);
    }
  });

  it("keeps feature server implementation edges within their owning slice", () => {
    const serverSources = productionSourcePaths(resolve(repositoryRoot, "features"))
      .filter((path) => /\/server(?:-[\w-]+)?\.ts$/.test(path));
    for (const source of serverSources) {
      const relative = source.slice(`${repositoryRoot}/`.length);
      expect(foreignFeatureImports(relative), `${relative} cannot become a cross-feature server aggregator`).toEqual([]);
    }
  });

  it("keeps newly composed server services below the production line cap", () => {
    for (const path of composedServerLineCapPaths) {
      expect(longestPhysicalLine(path), `${path} exceeds the production 240-character cap`).toBeLessThanOrEqual(240);
    }
  });

  it("does not retain a module-global server generation handle", () => {
    const server = readFileSync(resolve(repositoryRoot, "server.ts"), "utf8");
    expect(server).not.toMatch(/\blet\s+activeLifecycle\b/);
    expect(server).not.toMatch(/function\s+runtime\s*\(/);
  });
});
