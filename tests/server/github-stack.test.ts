import { describe, expect, it, vi } from "vitest";
import {
  fetchGitHubStack,
  readGitHubPullRequestDiff,
} from "../../features/pull-requests/server-stack.js";
import { createThreadStackService } from "../../features/pull-requests/server-thread-stack.js";
import { fetchGitHubStack as serverEntrypointFetchGitHubStack } from "../../server.js";
import { createServerLifecycle } from "../../server-lifecycle.js";

describe("GitHub Stack enrichment ownership", () => {
  it("evicts the oldest signal deterministically at the bounded cache limit", () => {
    const lifecycle = createServerLifecycle();
    const signal = { checks: "passing" as const, review: "approved" as const };

    for (let index = 0; index < 300; index += 1)
      lifecycle.cacheGitHubPullRequestSignal(`repo#${index}`, signal, Infinity);
    lifecycle.cacheGitHubPullRequestSignal("repo#300", signal, Infinity);

    expect(lifecycle.githubPullRequestSignalCache).toHaveLength(300);
    expect(lifecycle.githubPullRequestSignalCache.has("repo#0")).toBe(false);
    expect(lifecycle.githubPullRequestSignalCache.has("repo#1")).toBe(true);
    expect(lifecycle.githubPullRequestSignalCache.has("repo#300")).toBe(true);
  });

  it("keeps the entrypoint export pointed at the PR-owned Stack service", () => {
    expect(serverEntrypointFetchGitHubStack).toBe(fetchGitHubStack);
  });

  it("requires the caller lifecycle and enriches each layer through that generation", async () => {
    const lifecycle = createServerLifecycle();
    const run = async (args: readonly string[]) => {
      if (args[1] === "graphql") {
        return JSON.stringify({
          data: {
            repository: {
              p0: {
                reviewDecision: "APPROVED",
                reviewRequests: { totalCount: 0 },
                commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
              },
            },
          },
        });
      }
      return JSON.stringify([{
        number: 7,
        base: { ref: "main" },
        pull_requests: [{
          number: 7, state: "open", draft: false, title: "Lifecycle", html_url: "https://github.com/acme/work/pull/7",
          head: { ref: "feature/lifecycle" }, base: { ref: "main" },
        }],
      }]);
    };

    const stack = await fetchGitHubStack("acme", "work", 7, async (args, _maxBuffer) => run(args), lifecycle);
    expect(stack?.pullRequests).toEqual([expect.objectContaining({
      number: 7, checks: "passing", review: "approved",
    })]);
    expect(lifecycle.githubReadCache.size).toBe(0);
  });

  it("recovers a missing stack-layer diff from the pull request files endpoint", async () => {
    const run = vi.fn(async () =>
      JSON.stringify([
        {
          filename: "infra/load_balancer.py",
          previous_filename: null,
          status: "modified",
          additions: 18,
          deletions: 3,
        },
        {
          filename: "infra/old_policy.py",
          previous_filename: "infra/policy.py",
          status: "renamed",
          additions: 2,
          deletions: 1,
        },
      ]),
    );

    await expect(
      readGitHubPullRequestDiff("SystemEarth", "systemearth", 1184, run),
    ).resolves.toEqual({
      additions: 20,
      deletions: 4,
      files: [
        {
          path: "infra/load_balancer.py",
          previousPath: null,
          status: "modified",
          additions: 18,
          deletions: 3,
        },
        {
          path: "infra/old_policy.py",
          previousPath: "infra/policy.py",
          status: "renamed",
          additions: 2,
          deletions: 1,
        },
      ],
      truncated: false,
    });
    expect(run).toHaveBeenCalledWith(
      [
        "api",
        "--method",
        "GET",
        "repos/SystemEarth/systemearth/pulls/1184/files?per_page=100",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "X-GitHub-Api-Version: 2026-03-10",
      ],
      4_000_000,
    );
  });

  it("projects standalone pull request files without a gh-stack payload", async () => {
    const bb = {
      sdk: {
        threads: {
          get: vi.fn(async () => ({ environmentId: "env_pulumi" })),
        },
        environments: {
          pullRequest: vi.fn(async () => ({
            outcome: "available",
            pullRequest: {
              number: 1279,
              title: "Upgrade Pulumi",
              url: "https://github.com/SystemEarth/systemearth/pull/1279",
              state: "open",
              headRefName: "deps/upgrade-pulumi",
              baseRefName: "main",
              checks: {
                failedCount: 1,
                passedCount: 99,
                pendingCount: 0,
                state: "failing",
                totalCount: 100,
              },
              review: { reviewRequestCount: 0, state: "changes_requested" },
              attention: "checks_failed",
              mergeability: {
                mergeStateStatus: "BLOCKED",
                mergeable: "MERGEABLE",
                state: "blocked",
              },
            },
          })),
        },
        plugins: {
          callRpc: vi.fn(async () => ({
            stack: null,
            pending: null,
            error: null,
            fetchedAt: Date.now(),
          })),
        },
      },
    };
    const read = vi.fn(async (args: readonly string[]) =>
      args.some((value) => value.endsWith("/stacks"))
        ? "[]"
        : JSON.stringify([
            {
              filename: ".github/workflows/ci_pulumi_preview.yml",
              status: "modified",
              additions: 4,
              deletions: 2,
            },
          ]),
    );
    const service = createThreadStackService(
      bb as never,
      createServerLifecycle(),
      read,
    );

    const result = await service.projection("thr_pulumi");

    expect(result.githubStack?.stack?.branches).toHaveLength(1);
    expect(result.githubStack?.stack?.branches[0]).toMatchObject({
      name: "deps/upgrade-pulumi",
      isCurrent: true,
      pr: { number: 1279 },
      diff: {
        additions: 4,
        deletions: 2,
        files: [
          {
            path: ".github/workflows/ci_pulumi_preview.yml",
            status: "modified",
          },
        ],
      },
    });
  });
});
