import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { productionSourcePaths } from "../../../tests/architecture/production-source-paths.js";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

const legacyTokens = [
  ["get", "WorkChanges"].join(""),
  ["use", "LegacyWorkChanges"].join(""),
  ["get", "ThreadPullRequestChanges"].join(""),
  ["get", "PullRequestFingerprint"].join(""),
  ["thread", "Changes"].join(""),
  ["queryPolicies", "workChanges"].join("."),
  ["queryKeys", "work", "changes"].join("."),
  ["pull", "RequestChangesHeaderLabel"].join(""),
  ["PullRequest", "ChangesError"].join(""),
  ["features", "pull-requests", "views"].join("/"),
];

describe("R13 legacy Changes removal", () => {
  it("keeps migrated legacy names out of production TypeScript sources", () => {
    const productionSources = productionSourcePaths(repositoryRoot).map((path) => ({ path, source: readFileSync(path, "utf8") }));
    for (const token of legacyTokens) {
      const matches = productionSources.filter((file) => file.source.includes(token)).map((file) => file.path);
      expect(matches, `legacy token ${token} remains in production source`).toEqual([]);
    }
  });

  it("detects an in-process source match before asserting production absence", () => {
    const fixtureRoot = resolve(repositoryRoot, "tests/fixtures/nested");
    const matches = productionSourcePaths(fixtureRoot)
      .filter((path) => readFileSync(path, "utf8").includes("node:fs"));
    expect(matches).toEqual([resolve(fixtureRoot, "browser-node.ts")]);
  });

  it("keeps the R14 renderer dependency and its source/CSS markers out of production", () => {
    const packageJson = readFileSync("package.json", "utf8");
    const packageLock = readFileSync("package-lock.json", "utf8");
    expect(packageJson).not.toContain("react-diff-view");
    expect(packageLock).not.toContain("react-diff-view");
    expect(existsSync("components/work/changes.tsx")).toBe(false);

    const productionSource = [
      "app.tsx",
      "server.ts",
      "contracts.schemas.ts",
      "views.css",
      "features/changes/model.ts",
      "features/changes/queries.tsx",
      "features/changes/schemas.ts",
      "features/changes/server.ts",
      "features/changes/store.ts",
      "features/changes/views.tsx",
      "features/changes/host-renderer.tsx",
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    for (const token of ["react-diff-view", "ws-review-diff", "ws-diff-toolbar", "ws-split-diff", "ws-working-tree-patch"]) {
      expect(productionSource).not.toContain(token);
    }
  });
});
