import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import * as ts from "typescript";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const bareNodeBuiltins = new Set(builtinModules.map((name) => name.replace(/^node:/, "")));

type CompilerContext = {
  compilerOptions: ts.CompilerOptions;
};

function compilerContext(entry: string): CompilerContext {
  const configPath = ts.findConfigFile(dirname(entry), ts.sys.fileExists, "tsconfig.json");
  if (configPath === undefined) {
    throw new Error(`Could not find tsconfig.json for browser entry ${entry}`);
  }

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"));
  }

  return {
    compilerOptions: ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath)).options,
  };
}

function isSourceModule(path: string): boolean {
  return !path.endsWith(".d.ts") && sourceExtensions.has(extname(path));
}

function scriptKind(path: string): ts.ScriptKind {
  switch (extname(path)) {
    case ".tsx": return ts.ScriptKind.TSX;
    case ".jsx": return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs": return ts.ScriptKind.JS;
    default: return ts.ScriptKind.TS;
  }
}

function resolveSourceImport(importer: string, specifier: string, context: CompilerContext): string | null {
  const resolved = ts.resolveModuleName(specifier, importer, context.compilerOptions, ts.sys).resolvedModule;
  if (resolved === undefined || !isSourceModule(resolved.resolvedFileName)) {
    return null;
  }

  return resolve(resolved.resolvedFileName);
}

function runtimeImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];
  const add = (moduleSpecifier: ts.Expression): void => {
    if (ts.isStringLiteralLike(moduleSpecifier)) {
      imports.push(moduleSpecifier.text);
    }
  };

  const allTypeOnlyNamedImports = (importClause: ts.ImportClause | undefined): boolean => {
    if (importClause === undefined || importClause.name !== undefined || importClause.namedBindings === undefined) {
      return false;
    }
    return ts.isNamedImports(importClause.namedBindings)
      && importClause.namedBindings.elements.length > 0
      && importClause.namedBindings.elements.every((element) => element.isTypeOnly);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly && !allTypeOnlyNamedImports(node.importClause)) {
        add(node.moduleSpecifier);
      }
    } else if (ts.isExportDeclaration(node)) {
      const allTypeOnly = node.exportClause !== undefined
        && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0
        && node.exportClause.elements.every((element) => element.isTypeOnly);
      if (!node.isTypeOnly && !allTypeOnly && node.moduleSpecifier !== undefined) {
        add(node.moduleSpecifier);
      }
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression !== undefined) {
      add(node.moduleReference.expression);
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0) {
      add(node.arguments[0]!);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return imports;
}

function sourcePaths(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourcePaths(path);
    return isSourceModule(path) ? [path] : [];
  });
}

function isServerModule(path: string): boolean {
  const segments = resolve(path).split(sep);
  const basename = segments.at(-1) ?? "";
  return segments.slice(0, -1).includes("server")
    || /(?:^|[._-])server(?:[._-]|$)/.test(basename);
}

function isForbiddenBrowserRuntimeSpecifier(specifier: string): boolean {
  return specifier === "@get-bb/plugin-sdk"
    || specifier.startsWith("node:")
    || bareNodeBuiltins.has(specifier);
}

export function collectBrowserRuntimeGraph(entry: string): Map<string, string[]> {
  const resolvedEntry = resolve(entry);
  const context = compilerContext(resolvedEntry);
  const graph = new Map<string, string[]>();
  const pending = [resolvedEntry];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (graph.has(current)) {
      continue;
    }

    const sourceFile = ts.createSourceFile(
      current,
      readFileSync(current, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKind(current),
    );
    const imports = runtimeImports(sourceFile);
    graph.set(current, imports);

    for (const specifier of imports) {
      const resolved = resolveSourceImport(current, specifier, context);
      if (resolved !== null) {
        pending.push(resolved);
      }
    }
  }

  return graph;
}

export function assertBrowserRuntimeBoundary(entry: string): void {
  const resolvedEntry = resolve(entry);
  const context = compilerContext(resolvedEntry);
  const graph = collectBrowserRuntimeGraph(resolvedEntry);

  for (const [modulePath, imports] of graph) {
    for (const specifier of imports) {
      if (isForbiddenBrowserRuntimeSpecifier(specifier)) {
        throw new Error(`Browser module ${modulePath} imports forbidden runtime module ${specifier}`);
      }

      const resolved = resolveSourceImport(modulePath, specifier, context);
      if (resolved !== null && isServerModule(resolved)) {
        throw new Error(`Browser module ${modulePath} reaches server module ${resolved}`);
      }
    }
  }
}

/**
 * Resolves component runtime imports through TypeScript's module resolver so
 * aliases, extensions, and directory indexes are checked consistently.
 */
export function collectComponentsRuntimeImportGraph(repositoryRoot: string): Map<string, string[]> {
  const resolvedRoot = resolve(repositoryRoot);
  const context = compilerContext(resolve(resolvedRoot, "app.tsx"));
  const graph = new Map<string, string[]>();
  const componentsRoot = resolve(resolvedRoot, "components");

  for (const importer of sourcePaths(componentsRoot)) {
    const sourceFile = ts.createSourceFile(
      importer,
      readFileSync(importer, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKind(importer),
    );
    const resolvedImports = runtimeImports(sourceFile)
      .map((specifier) => resolveSourceImport(importer, specifier, context))
      .filter((path): path is string => path !== null);
    graph.set(importer, resolvedImports);
  }

  return graph;
}

export function assertNoComponentsToFeaturesRuntimeImports(
  graph: ReadonlyMap<string, readonly string[]>,
  repositoryRoot: string,
): void {
  const componentsRoot = resolve(repositoryRoot, "components");
  const featuresRoot = resolve(repositoryRoot, "features");
  const isWithin = (path: string, directory: string) => {
    const remainder = relative(directory, resolve(path));
    return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
  };
  const violations: string[] = [];
  for (const [importer, imports] of graph) {
    for (const imported of imports) {
      if (isWithin(importer, componentsRoot) && isWithin(imported, featuresRoot)) {
        violations.push(`${importer} -> ${imported}`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`components/ runtime imports must not reach features/: ${violations.join(", ")}`);
  }
}
