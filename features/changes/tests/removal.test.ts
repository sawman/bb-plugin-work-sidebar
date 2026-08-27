import { spawnSync } from "node:child_process";
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
});
