import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertBrowserRuntimeBoundary } from "./import-graph";

const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../../..");
const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
};
const packageLock = JSON.parse(readFileSync(resolve(repositoryRoot, "package-lock.json"), "utf8")) as {
  packages: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
};
const rootLockPackage = packageLock.packages[""]!;

const hostShims = {
  "@pierre/diffs": "^1.2.9",
  "@radix-ui/react-alert-dialog": "^1.1.19",
  "@radix-ui/react-context-menu": "^2.3.3",
  "@radix-ui/react-dialog": "^1.1.19",
  "@radix-ui/react-dropdown-menu": "^2.1.20",
  "@radix-ui/react-hover-card": "^1.1.19",
  "@radix-ui/react-menubar": "^1.1.20",
  "@radix-ui/react-navigation-menu": "^1.2.18",
  "@radix-ui/react-popover": "^1.1.19",
  "@radix-ui/react-select": "^2.3.3",
  "@radix-ui/react-tooltip": "^1.2.12",
  "class-variance-authority": "^0.7.1",
  clsx: "^2.1.1",
  sonner: "^1.7.4",
  "tailwind-merge": "^3.4.0",
  vaul: "^1.1.2",
} as const;

describe("R1 package and compile boundary", () => {
  it("pins the SDK and keeps host shims out of the plugin bundle", () => {
    expect(packageJson.engines?.bbPluginSdk).toBe(">=0.4.21");
    expect(packageJson.devDependencies?.["@get-bb/plugin-sdk"]).toBe("0.4.21");
    expect(packageJson.dependencies?.["@get-bb/plugin-sdk"]).toBeUndefined();

    for (const [name, version] of Object.entries(hostShims)) {
      expect(packageJson.devDependencies?.[name], `${name} must be a host-aligned devDependency`).toBe(version);
      expect(packageJson.dependencies?.[name], `${name} must not be bundled`).toBeUndefined();
      expect(rootLockPackage.devDependencies?.[name]).toBe(version);
      expect(rootLockPackage.dependencies?.[name]).toBeUndefined();
    }

    expect(packageJson.devDependencies?.react).toBeDefined();
    expect(packageJson.dependencies?.react).toBeUndefined();
    expect(packageJson.devDependencies?.["react-dom"]).toBeDefined();
    expect(packageJson.dependencies?.["react-dom"]).toBeUndefined();
    expect(packageJson.devDependencies?.["@testing-library/react"]).toBeDefined();
    expect(packageJson.devDependencies?.["better-sqlite3"]).toBeDefined();
    expect(packageJson.devDependencies?.["jsdom"]).toBeDefined();
    expect(packageJson.devDependencies?.["axe-core"]).toBe("^4.13.0");
    expect(packageJson.devDependencies?.["vitest-axe"]).toBe("^0.1.0");
    expect(packageJson.dependencies?.["@tanstack/react-query"]).toBeDefined();
    expect(packageJson.dependencies?.zustand).toBeDefined();
    expect(packageJson.devDependencies?.["@tanstack/react-query"]).toBeUndefined();
    expect(packageJson.devDependencies?.zustand).toBeUndefined();

    expect(rootLockPackage.devDependencies?.["@get-bb/plugin-sdk"]).toBe("0.4.21");
    expect(rootLockPackage.dependencies?.["@tanstack/react-query"]).toBe(packageJson.dependencies?.["@tanstack/react-query"]);
    expect(rootLockPackage.dependencies?.zustand).toBe(packageJson.dependencies?.zustand);
    expect(packageJson.dependencies?.["react-diff-view"]).toBeUndefined();
    expect(rootLockPackage.dependencies?.["react-diff-view"]).toBeUndefined();
  });

  it("includes nested source and test TypeScript files", () => {
    const tsconfig = JSON.parse(readFileSync(resolve(repositoryRoot, "tsconfig.json"), "utf8")) as {
      include?: string[];
    };

    expect(tsconfig.include).toEqual(expect.arrayContaining(["**/*.ts", "**/*.tsx"]));
    expect(existsSync(resolve(repositoryRoot, "tests/architecture/package-contract.test.ts"))).toBe(true);
    expect(existsSync(resolve(repositoryRoot, "tests/fixtures/nested/type-error.ts"))).toBe(true);
  });

  it("proves the nested type-error fixture is rejected by TypeScript", () => {
    const fixture = resolve(repositoryRoot, "tests/fixtures/nested/type-error.ts");
    const result = spawnSync(process.platform === "win32" ? "tsc.cmd" : "tsc", [
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      fixture,
    ], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("Type 'number' is not assignable to type 'string'");
  });

  it("keeps the app runtime graph browser-safe", () => {
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "app.tsx"))).not.toThrow();
  });

  it("rejects root SDK, Node, and server imports from browser graphs", () => {
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "tests/fixtures/nested/browser-root-sdk.ts")))
      .toThrow("@get-bb/plugin-sdk");
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "tests/fixtures/nested/browser-node.ts")))
      .toThrow("node:fs");
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "tests/fixtures/nested/browser-bare-node.ts")))
      .toThrow("fs");
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "tests/fixtures/nested/browser-server.ts")))
      .toThrow("server module");
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "tests/fixtures/nested/browser-server-directory.ts")))
      .toThrow("server module");
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "tests/fixtures/nested/browser-mixed-server.ts")))
      .toThrow("server module");
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "tests/fixtures/nested/browser-server-lifecycle.ts")))
      .toThrow("server module");
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "tests/fixtures/nested/browser-server-feature.ts")))
      .toThrow("server module");
  });

  it("allows type-only contract and server imports", () => {
    expect(() => assertBrowserRuntimeBoundary(resolve(repositoryRoot, "tests/fixtures/nested/browser-type-only.ts")))
      .not.toThrow();
  });

});
