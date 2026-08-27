import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Lists production TypeScript sources without relying on a shell executable. */
export function productionSourcePaths(directory = process.cwd()): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "tests"].includes(entry.name)) return [];
      return productionSourcePaths(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}
