import { describe, expect, it } from "vitest";
import { fetchGitHubStack } from "../../server.js";
import { createServerLifecycle } from "../../server-lifecycle.js";

describe("GitHub Stack enrichment ownership", () => {
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
