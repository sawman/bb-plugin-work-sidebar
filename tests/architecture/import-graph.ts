import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx"] as const;

function resolveSourceImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const candidate = resolve(dirname(importer), specifier);
  const candidates = [
    candidate,
    ...sourceExtensions.map((extension) => `${candidate}${extension}`),
    ...sourceExtensions.map((extension) => resolve(candidate, `index${extension}`)),
  ];

  return candidates.find((path) => {
    try {
      return extname(path) !== "" && readFileSync(path, "utf8") !== undefined;
    } catch {
      return false;
    }
  }) ?? null;
}

function runtimeImports(source: string): string[] {
  const withoutTypeImports = source.replace(
    /import\s+type(?:[\s\S]*?)?from\s*["'][^"']+["']\s*;?/g,
    "",
  );

  return [
    ...withoutTypeImports.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g),
    ...withoutTypeImports.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]!);
}

export function collectBrowserRuntimeGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const pending = [resolve(entry)];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (graph.has(current)) {
      continue;
    }

    const imports = runtimeImports(readFileSync(current, "utf8"));
    graph.set(current, imports);

    for (const specifier of imports) {
      const resolved = resolveSourceImport(current, specifier);
      if (resolved !== null) {
        pending.push(resolved);
      }
    }
  }

  return graph;
}

export function assertBrowserRuntimeBoundary(entry: string): void {
  const graph = collectBrowserRuntimeGraph(entry);

  for (const [modulePath, imports] of graph) {
    for (const specifier of imports) {
      if (specifier === "@get-bb/plugin-sdk" || specifier.startsWith("node:")) {
        throw new Error(`Browser module ${modulePath} imports forbidden runtime module ${specifier}`);
      }

      if (specifier.startsWith(".") && resolveSourceImport(modulePath, specifier)?.split("/").at(-1)?.startsWith("server.")) {
        throw new Error(`Browser module ${modulePath} reaches server module ${specifier}`);
      }
    }
  }
}
