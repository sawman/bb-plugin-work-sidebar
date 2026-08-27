import { describe, expect, it } from "vitest";
import { fetchGitHubStack } from "../../features/pull-requests/server-stack.js";
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
});
