import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    for (const token of legacyTokens) {
      const result = spawnSync(
        "rg",
        [
          "-l",
          "-F",
          token,
          "--glob",
          "!**/tests/**",
          "--glob",
          "*.ts",
          "--glob",
          "*.tsx",
          ".",
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status, result.stdout || result.stderr).toBe(1);
    }
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
