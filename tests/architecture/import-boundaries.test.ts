import { readFileSync } from "node:fs";
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
});
