import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { assertBrowserRuntimeBoundary } from "./import-graph.js";

const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../../..");

function physicalLines(path: string): number {
  return readFileSync(resolve(repositoryRoot, path), "utf8").split("\n").length - 1;
}

function longestLine(path: string): number {
  return Math.max(
    ...readFileSync(resolve(repositoryRoot, path), "utf8")
      .split("\n")
      .map((line) => line.length),
  );
}

const threadsCompositionBudgets = {
  // The controller retains host/query wiring and the one shared links observer.
  "features/threads/sidebar-controller.tsx": 350,
  // Settings/menu presentation remains an independently reviewable primitive.
  "features/threads/sidebar-toolbar.tsx": 220,
  // Native/enhanced switching is intentionally only a small composition seam.
  "features/threads/sidebar-work-view.tsx": 160,
  // Group drop zones and recursive live trees are the largest owned composition.
  "features/threads/sidebar-group-tree.tsx": 240,
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
  it("keeps browser runtime imports out of server-owned feature adapters", () => {
    assertBrowserRuntimeBoundary(resolve(repositoryRoot, "app.tsx"));
  });

  it("holds composition entries below the R15 baseline after their owned slices moved", () => {
    // R15's integrated baseline is 661/1748/8/239 physical lines. The R16
    // target is the concrete remaining ownership: app loses its generic slot
    // provider wrapper, server loses the Work-binding workflow, and
    // contracts stay a server-only composition plus browser-safe schemas.
    expect(physicalLines("app.tsx")).toBeLessThanOrEqual(350);
    expect(physicalLines("server.ts")).toBeLessThanOrEqual(1_600);
    expect(physicalLines("contracts.ts")).toBeLessThanOrEqual(12);
    expect(physicalLines("contracts.schemas.ts")).toBeLessThanOrEqual(250);
    // The R15 entrypoints had 37 app and 58 server top-level implementation
    // declarations. R16 composes explicit slice factories instead: a new
    // feature implementation must live below its owner, not be hidden by
    // reformatting this entrypoint.
    expect(topLevelImplementationDeclarations("app.tsx")).toBeLessThanOrEqual(30);
    expect(topLevelImplementationDeclarations("server.ts")).toBeLessThanOrEqual(45);
    expect(longestLine("app.tsx")).toBeLessThanOrEqual(240);
  });

  it("does not retain a module-global server generation handle", () => {
    const server = readFileSync(resolve(repositoryRoot, "server.ts"), "utf8");
    expect(server).not.toMatch(/\blet\s+activeLifecycle\b/);
    expect(server).not.toMatch(/function\s+runtime\s*\(/);
  });

  it("keeps Threads sidebar composition small and independent of Tasks/PR state", () => {
    for (const [path, budget] of Object.entries(threadsCompositionBudgets)) {
      expect(physicalLines(path), `${path} physical-line budget`).toBeLessThanOrEqual(budget);
      expect(longestLine(path), `${path} maximum physical line length`).toBeLessThanOrEqual(240);
    }
    for (const path of threadSourcePaths()) {
      expect(runtimeImports(path), `${path} must not own another slice's state`).not.toContain("@/features/tasks/store");
      expect(runtimeImports(path), `${path} must not own another slice's state`).not.toContain("@/features/pull-requests/store");
    }
    expect(sourceCallCount("features/threads/sidebar-controller.tsx", "useTaskLinksRead")).toBe(1);
  });
});
