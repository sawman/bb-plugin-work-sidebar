import { describe, expect, it, vi } from "vitest";
import {
  fetchGitHubStack,
  readGitHubPullRequestFilePatch,
  readGitHubSignals,
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

  it("includes branch metadata in the existing authored PR signal read", async () => {
    const lifecycle = createServerLifecycle();
    const run = vi.fn(async (_args: readonly string[], _maxBuffer: number) =>
      JSON.stringify({
        data: {
          repository: {
            p0: {
              headRefName: "feature/authored-row",
              baseRefName: "main",
              reviewDecision: "CHANGES_REQUESTED",
              reviewRequests: {
                totalCount: 2,
                nodes: [
                  { requestedReviewer: { login: "octocat" } },
                  { requestedReviewer: { slug: "platform-team" } },
                ],
              },
              latestReviews: {
                nodes: [
                  {
                    author: { login: "octocat" },
                    state: "CHANGES_REQUESTED",
                    submittedAt: "2026-09-04T00:00:00Z",
                  },
                ],
              },
              commits: {
                nodes: [
                  { commit: { statusCheckRollup: { state: "SUCCESS" } } },
                ],
              },
            },
          },
        },
      }),
    );

    const signals = await readGitHubSignals(
      "acme",
      "repo",
      [91],
      lifecycle,
      run,
    );

    expect(signals.get(91)).toEqual({
      head: "feature/authored-row",
      base: "main",
      checks: "passing",
      review: "review_required",
      requestedReviewers: ["octocat", "platform-team"],
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0].join(" ")).toContain(
      "headRefName baseRefName",
    );
    expect(run.mock.calls[0]?.[0].join(" ")).toContain(
      "requestedReviewer",
    );
    expect(run.mock.calls[0]?.[0].join(" ")).toContain("latestReviews");
  });

  it("retains branch metadata when authored PR signals fall back to REST", async () => {
    const lifecycle = createServerLifecycle();
    const run = vi.fn(async (args: readonly string[]) => {
      if (args[1] === "graphql") throw new Error("GraphQL unavailable");
      if (args.some((value) => value.endsWith("/reviews?per_page=100"))) {
        return JSON.stringify([{
          user: { login: "reviewer-one" },
          state: "CHANGES_REQUESTED",
        }]);
      }
      return JSON.stringify({
        head: { ref: "feature/rest-fallback", sha: null },
        base: { ref: "main" },
        requested_reviewers: [{ login: "reviewer-one" }],
        requested_teams: [{ slug: "platform-team" }],
      });
    });

    const signals = await readGitHubSignals(
      "acme",
      "repo",
      [92],
      lifecycle,
      run,
    );

    expect(signals.get(92)).toEqual({
      head: "feature/rest-fallback",
      base: "main",
      checks: "unknown",
      review: "review_required",
      requestedReviewers: ["reviewer-one", "platform-team"],
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("uses one REST recovery snapshot for incomplete stack PR metadata and signals", async () => {
    const lifecycle = createServerLifecycle();
    const run = vi.fn(async (args: readonly string[]) => {
      if (args.some((value) => value.endsWith("/stacks"))) {
        return JSON.stringify([{ number: 12, base: { ref: "main" }, pull_requests: [{
          number: 12, state: "open", draft: false, title: "", html_url: "",
        }] }]);
      }
      if (args.some((value) => value.endsWith("/reviews?per_page=100")))
        return JSON.stringify([{ user: { login: "reviewer" }, state: "APPROVED" }]);
      if (args.some((value) => value.includes("/check-runs?per_page=100")))
        return JSON.stringify({ check_runs: [{ status: "completed", conclusion: "SUCCESS" }] });
      if (args[1] === "graphql") throw new Error("GraphQL should not run after REST recovery");
      return JSON.stringify({
        title: "Recovered title",
        html_url: "https://github.com/acme/repo/pull/12",
        state: "open",
        draft: false,
        head: { ref: "feature/recovered", sha: "abc" },
        base: { ref: "main" },
        requested_reviewers: [{ login: "reviewer" }],
        requested_teams: [],
        review_comments: 4,
      });
    });

    const stack = await fetchGitHubStack("acme", "repo", 12, run, lifecycle);

    expect(stack?.pullRequests).toEqual([expect.objectContaining({
      number: 12,
      title: "Recovered title",
      url: "https://github.com/acme/repo/pull/12",
      head: "feature/recovered",
      base: "main",
      checks: "passing",
      review: "approved",
      requestedReviewers: ["reviewer"],
    })]);
    expect(run.mock.calls.some(([args]) => (args as readonly string[])[1] === "graphql")).toBe(false);
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

  it("loads only the selected pull request file patch on demand", async () => {
    const run = vi.fn(async () =>
      JSON.stringify([
        {
          filename: "src/selected.ts",
          status: "modified",
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
        {
          filename: "src/other.ts",
          status: "modified",
          patch: "@@ -1 +1 @@\n-before\n+after",
        },
      ]),
    );

    await expect(
      readGitHubPullRequestFilePatch(
        "acme",
        "repo",
        42,
        "src/selected.ts",
        run,
      ),
    ).resolves.toEqual({
      kind: "patch",
      path: "src/selected.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      message: null,
    });
    await expect(
      readGitHubPullRequestFilePatch(
        "acme",
        "repo",
        42,
        "src/missing.ts",
        run,
      ),
    ).resolves.toMatchObject({
      kind: "absent",
      path: "src/missing.ts",
    });
    expect(run).toHaveBeenCalledWith(
      [
        "api",
        "--method",
        "GET",
        "repos/acme/repo/pulls/42/files?per_page=100",
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

  it("normalizes an incomplete current PR through the same REST recovery path", async () => {
    const bb = {
      sdk: {
        threads: { get: vi.fn(async () => ({ environmentId: "env_recovery" })) },
        environments: {
          pullRequest: vi.fn(async () => ({
            outcome: "available",
            pullRequest: {
              number: 1280,
              title: "",
              url: "https://github.com/acme/repo/pull/1280",
              state: "open",
              headRefName: "",
              baseRefName: "",
              checks: { failedCount: 0, passedCount: 0, pendingCount: 0, state: "unknown", totalCount: 0 },
              review: { reviewRequestCount: 0, state: "none" },
              attention: "none",
              mergeability: { mergeStateStatus: "UNKNOWN", mergeable: "UNKNOWN", state: "unknown" },
            },
          })),
        },
        plugins: {
          callRpc: vi.fn(async () => ({
            stack: {
              trunk: "main",
              currentBranch: "feature/current",
              branches: [{
                name: "feature/current",
                isCurrent: true,
                isMerged: false,
                isQueued: false,
                needsRebase: false,
                hasStash: false,
                stashCount: null,
                pr: { number: 1280, url: "https://github.com/acme/repo/pull/1280", state: "open", title: null, isDraft: false, metadataStale: false },
                diff: null,
                aheadOfRemote: null,
                behindRemote: null,
              }],
              trunkBehind: null,
              prunableBranchCount: null,
            },
            pending: null,
            error: null,
            fetchedAt: Date.now(),
          })),
        },
      },
    };
    const read = vi.fn(async (args: readonly string[]) => {
      if (args.some((value) => value.endsWith("/stacks"))) {
        return JSON.stringify([{ number: 1280, base: { ref: "main" }, pull_requests: [{
          number: 1280, state: "open", draft: false, title: "", html_url: "",
        }] }]);
      }
      if (args.some((value) => value.endsWith("/reviews?per_page=100"))) return "[]";
      if (args.some((value) => value.includes("/check-runs?per_page=100")))
        return JSON.stringify({ check_runs: [{ status: "completed", conclusion: "SUCCESS" }] });
      if (args.some((value) => value.includes("/files?per_page=100"))) return "[]";
      return JSON.stringify({
        title: "Recovered current title",
        html_url: "https://github.com/acme/repo/pull/1280",
        state: "open",
        draft: false,
        head: { ref: "feature/current", sha: "def" },
        base: { ref: "main" },
        requested_reviewers: [],
        requested_teams: [],
        review_comments: 3,
      });
    });
    const service = createThreadStackService(bb as never, createServerLifecycle(), read);

    const result = await service.projection("thr_recovery");

    expect(result.currentPullRequest).toMatchObject({
      title: "Recovered current title",
      head: "feature/current",
      base: "main",
      checks: { passedCount: 1, state: "passing", totalCount: 1 },
      review: { reviewRequestCount: 0, state: "none" },
      signal: { checks: "passing", review: "none", reviewCommentCount: 3 },
    });
    expect(result.githubStack?.stack?.branches[0]?.pr).toMatchObject({
      title: "Recovered current title",
      url: "https://github.com/acme/repo/pull/1280",
      state: "open",
    });
  });
});
