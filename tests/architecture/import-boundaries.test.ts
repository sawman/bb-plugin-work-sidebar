import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  assertBrowserRuntimeBoundary,
  assertNoComponentsToFeaturesRuntimeImports,
  collectComponentsRuntimeImportGraph,
} from "./import-graph.js";
import { productionSourcePaths } from "./production-source-paths.js";

const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../../..");

function physicalLines(path: string): number {
  return readFileSync(resolve(repositoryRoot, path), "utf8").split("\n").length - 1;
}

function longestPhysicalLine(path: string): number {
  return Math.max(...readFileSync(resolve(repositoryRoot, path), "utf8").split("\n").map((line) => line.length));
}

const registrationBudgets: Record<string, { lines: number; declarations: number }> = {
  "features/agents/server-registration.ts": { lines: 40, declarations: 1 },
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
    .filter((feature) => ["agents", "changes", "pull-requests", "tasks", "threads", "tracker", "work-context"].includes(feature))
    .filter((feature) => feature !== ownFeature)
    .filter((feature) => !(permittedBindingSeam && feature === "work-context"));
}

const threadsCompositionBudgets = {
  // The controller retains host/query wiring and the one shared links observer.
  "features/threads/sidebar-controller.tsx": 350,
  // Settings/menu presentation remains an independently reviewable primitive.
  "features/threads/sidebar-toolbar.tsx": 220,
  // BB selects the replacement; this module only composes the enhanced view.
  "features/threads/sidebar-work-view.tsx": 160,
  // Group drop zones and recursive live trees are the largest owned composition.
  "features/threads/sidebar-group-tree.tsx": 240,
} as const;

const threadRowCompositionBudgets = {
  // R21D refuses the former 725-line row aggregator. Each budget protects one
  // named responsibility, rather than allowing a differently named monolith.
  "features/threads/thread-row.tsx": { lines: 240, declarations: 1 },
  "features/threads/thread-tree.tsx": { lines: 130, declarations: 1 },
  "features/threads/thread-row-presentation.tsx": { lines: 170, declarations: 4 },
  "features/threads/thread-row-menu.tsx": { lines: 120, declarations: 1 },
  "features/threads/use-thread-row-actions.ts": { lines: 65, declarations: 1 },
  "features/threads/use-thread-row-pointer-drag.ts": { lines: 175, declarations: 1 },
  "features/threads/thread-tree-model.ts": { lines: 40, declarations: 1 },
  "features/threads/thread-row-types.ts": { lines: 90, declarations: 0 },
} as const;

function runtimeImports(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(resolve(repositoryRoot, path), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return source.statements.flatMap((statement) =>
    ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly
      ? [statement.moduleSpecifier.getText(source).slice(1, -1)]
      : [],
  );
}

function threadSourcePaths(directory = "features/threads"): string[] {
  return readdirSync(resolve(repositoryRoot, directory)).flatMap((entry) => {
    const path = `${directory}/${entry}`;
    if (statSync(resolve(repositoryRoot, path)).isDirectory()) return threadSourcePaths(path);
    return /\.[jt]sx?$/.test(entry) && !entry.endsWith(".d.ts") ? [path] : [];
  });
}

function sourceCallCount(path: string, name: string): number {
  const source = ts.createSourceFile(path, readFileSync(resolve(repositoryRoot, path), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
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
  it("keeps components runtime-independent from feature slices and proves the gate rejects an illegal edge", () => {
    const graph = collectComponentsRuntimeImportGraph(repositoryRoot);
    expect(() => assertNoComponentsToFeaturesRuntimeImports(graph, repositoryRoot)).not.toThrow();

    const negativeControl = new Map(graph);
    negativeControl.set(resolve(repositoryRoot, "components/negative-control.tsx"), [
      resolve(repositoryRoot, "features/tasks/model.ts"),
    ]);
    expect(() => assertNoComponentsToFeaturesRuntimeImports(negativeControl, repositoryRoot)).toThrow(
      /components\/ runtime imports must not reach features\//,
    );
  });

  it("caps every production TypeScript physical line at 240 characters", () => {
    const violations = productionSourcePaths(repositoryRoot)
      .map((path) => ({
        path: path.slice(`${repositoryRoot}/`.length),
        length: longestPhysicalLine(path.slice(`${repositoryRoot}/`.length)),
      }))
      .filter(({ length }) => length > 240)
      .map(({ path, length }) => `${path} (${length} chars)`);

    expect(violations, "production TypeScript physical lines must stay reviewable").toEqual([]);
  });

  it("keeps browser runtime imports out of server-owned feature adapters", () => {
    assertBrowserRuntimeBoundary(resolve(repositoryRoot, "app.tsx"));
  });

  it("requires server.ts to be a real registration/composition boundary", () => {
    // A server entry may compose factories and register handlers, but feature
    // workflows belong below their owning feature modules. This intentionally
    // rejects the former 1,586-line entry instead of ratifying it with slack.
    expect(physicalLines("app.tsx")).toBeLessThanOrEqual(350);
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
    expect(longestPhysicalLine("app.tsx")).toBeLessThanOrEqual(240);
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

  it("keeps Threads sidebar composition small and independent of Tasks/PR state", () => {
    for (const [path, budget] of Object.entries(threadsCompositionBudgets)) {
      expect(physicalLines(path), `${path} physical-line budget`).toBeLessThanOrEqual(budget);
      expect(longestPhysicalLine(path), `${path} maximum physical line length`).toBeLessThanOrEqual(240);
    }
    for (const [path, budget] of Object.entries(threadRowCompositionBudgets)) {
      expect(physicalLines(path), `${path} physical-line budget`).toBeLessThanOrEqual(budget.lines);
      expect(topLevelImplementationDeclarations(path), `${path} declaration budget`).toBeLessThanOrEqual(budget.declarations);
      expect(longestPhysicalLine(path), `${path} maximum physical line length`).toBeLessThanOrEqual(240);
    }
    for (const path of threadSourcePaths()) {
      expect(runtimeImports(path), `${path} must not own another slice's state`).not.toContain("@/features/tasks/store");
      expect(runtimeImports(path), `${path} must not own another slice's state`).not.toContain("@/features/pull-requests/store");
    }
    expect(sourceCallCount("features/threads/sidebar-controller.tsx", "useTaskLinksRead")).toBe(1);
  });

  it("keeps visible thread-tree traversal inside the Threads slice", () => {
    const rootModel = readFileSync(resolve(repositoryRoot, "work-model.ts"), "utf8");
    const threadTreeModel = readFileSync(
      resolve(repositoryRoot, "features/threads/thread-tree-model.ts"),
      "utf8",
    );

    expect(rootModel).not.toMatch(/\bvisibleThreadTreeIds\b/);
    expect(threadTreeModel).toMatch(/export function visibleThreadTreeIds/);
  });
});
