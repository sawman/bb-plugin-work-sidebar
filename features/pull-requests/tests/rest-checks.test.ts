import { describe, expect, it, vi } from "vitest";
import { readGitHubPullRequestRest } from "../server-stack";
import { createServerLifecycle } from "../../../server-lifecycle";

describe("complete REST checks at the production fallback boundary", () => {
  it.each([
    ["failure", "success", "failed", 1, 1, 0],
    ["success", "error", "failed", 1, 1, 0],
    ["neutral", "pending", "pending", 0, 1, 1],
    ["skipped", "success", "passing", 0, 2, 0],
    ["stale", "success", "pending", 0, 1, 1],
  ] as const)("combines lowercase run %s with legacy %s without a false passing result", async (conclusion, legacy, state, failed, passed, pending) => {
    const lifecycle = createServerLifecycle();
    const read = vi.fn(async (args: readonly string[]) => {
      const target = args.find((arg) => arg.startsWith("repos/"))!;
      if (target.includes("/reviews")) return "[]";
      if (target.includes("/check-runs")) return JSON.stringify({ total_count: 1, check_runs: [{ status: "completed", conclusion, head_sha: "sha1" }] });
      if (target.includes("/status?")) return JSON.stringify({ total_count: 1, sha: "sha1", statuses: [{ state: legacy }] });
      return JSON.stringify({ number: 1, title: "PR", state: "open", draft: false, head: { ref: "feature", sha: "sha1" }, base: { ref: "main", sha: "base" }, requested_reviewers: [], requested_teams: [] });
    });
    try {
      const result = await readGitHubPullRequestRest("acme", "repo", 1, lifecycle, read);
      expect(result?.signal.checks).toBe(state);
      expect(result?.checks).toMatchObject({ failedCount: failed, passedCount: passed, pendingCount: pending, totalCount: 2 });
    } finally { lifecycle.dispose(); }
  });

  it.each([0, 1, 101])("reads every page for %i contexts in each source with bounded command costs", async (count) => {
    const lifecycle = createServerLifecycle();
    const read = vi.fn(async (args: readonly string[]) => {
      const target = args.find((arg) => arg.startsWith("repos/"))!;
      const page = Number(target.match(/&page=(\d+)/)?.[1] ?? 1);
      const length = Math.min(100, Math.max(0, count - (page - 1) * 100));
      if (target.includes("/reviews")) return "[]";
      if (target.includes("/check-runs")) return JSON.stringify({ total_count: count, check_runs: Array.from({ length }, () => ({ status: "completed", conclusion: "success", head_sha: "sha1" })) });
      if (target.includes("/status?")) return JSON.stringify({ total_count: count, sha: "sha1", statuses: Array.from({ length }, () => ({ state: "success" })) });
      return JSON.stringify({ title: "PR", state: "open", draft: false, head: { ref: "feature", sha: "sha1" }, base: { ref: "main", sha: "base" }, requested_reviewers: [] });
    });
    try {
      const result = await readGitHubPullRequestRest("acme", "repo", 1, lifecycle, read);
      expect(result?.checks).toMatchObject({ totalCount: 2 * count, state: count ? "passing" : "no_checks" });
      expect(read).toHaveBeenCalledTimes(3 + 2 * Math.max(1, Math.ceil(count / 100)));
    } finally { lifecycle.dispose(); }
  });

  it.each(["head-changed", "legacy-error", "truncated"])("does not certify checks when %s", async (problem) => {
    const lifecycle = createServerLifecycle(); let metadataReads = 0;
    const read = vi.fn(async (args: readonly string[]) => {
      const target = args.find((arg) => arg.startsWith("repos/"))!;
      if (target.includes("/reviews")) return "[]";
      if (target.includes("/check-runs")) return JSON.stringify({ total_count: problem === "truncated" ? 2_000 : 1, check_runs: [{ status: "completed", conclusion: "success", head_sha: "sha1" }] });
      if (target.includes("/status?")) {
        if (problem === "legacy-error") throw new Error("offline");
        return JSON.stringify({ total_count: 0, sha: "sha1", statuses: [] });
      }
      metadataReads++;
      return JSON.stringify({ title: "PR", state: "open", draft: false, head: { ref: "feature", sha: problem === "head-changed" && metadataReads > 1 ? "sha2" : "sha1" }, base: { ref: "main", sha: "base" }, requested_reviewers: [] });
    });
    try {
      expect(await readGitHubPullRequestRest("acme", "repo", 1, lifecycle, read)).toBeNull();
      expect(read.mock.calls.length).toBeLessThanOrEqual(24);
    } finally { lifecycle.dispose(); }
  });
});
