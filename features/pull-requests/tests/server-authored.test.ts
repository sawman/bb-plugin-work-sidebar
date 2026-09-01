import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server";
import { createAuthoredPullRequestService } from "../server-authored";
import type { GitHubCommandService } from "../server-github-read";

describe("authored pull-request stack wire projection", () => {
  it("reports cached GraphQL and REST budgets with the shared health state", async () => {
    const host = createFakePluginHost();
    const lifecycle = createServerLifecycle();
    lifecycle.githubGraphqlHealth = {
      state: "rate_limited",
      scope: "graphql",
      message: "GitHub GraphQL is rate limited; using REST where possible.",
      retryAt: 123,
    };
    const read = vi.fn(async () =>
      JSON.stringify({
        resources: {
          graphql: { limit: 5_000, remaining: 0, reset: 123 },
          core: { limit: 5_000, remaining: 4_812, reset: 456 },
        },
      }),
    );
    const handlers = createAuthoredPullRequestService(
      host.bb,
      lifecycle,
      { read, execute: vi.fn() } as unknown as GitHubCommandService,
    );

    await expect(handlers.getGitHubApiHealth(null)).resolves.toEqual({
      state: "rate_limited",
      scope: "graphql",
      message: "GitHub GraphQL is rate limited; using REST where possible.",
      retryAt: 123,
      limits: {
        graphql: { limit: 5_000, remaining: 0, resetAt: 123_000 },
        rest: { limit: 5_000, remaining: 4_812, resetAt: 456_000 },
      },
    });
    expect(read).toHaveBeenCalledWith(["api", "rate_limit"], 1_000_000, 30_000);
    await host.harness.lifecycle.dispose();
  });

  it("loads all stacks once per repository instead of probing every authored PR", async () => {
    const host = createFakePluginHost();
    const lifecycle = createServerLifecycle();
    const read = vi.fn(async (args: readonly string[]) => {
      const command = args.join(" ");
      if (args[0] === "search")
        return JSON.stringify([
          {
            number: 12,
            title: "Base layer",
            url: "https://github.com/acme/sidebar/pull/12",
            repository: { nameWithOwner: "acme/sidebar" },
            state: "OPEN",
            isDraft: false,
          },
          {
            number: 13,
            title: "Child layer",
            url: "https://github.com/acme/sidebar/pull/13",
            repository: { nameWithOwner: "acme/sidebar" },
            state: "OPEN",
            isDraft: false,
          },
        ]);
      if (command.includes("isArchived"))
        return JSON.stringify({ data: { r0: { isArchived: false } } });
      if (command.includes("pullRequest(number"))
        return JSON.stringify({
          data: {
            repository: {
              p0: {
                headRefName: "feature/base",
                baseRefName: "main",
                reviewDecision: "APPROVED",
                reviewRequests: { totalCount: 0, nodes: [] },
                commits: {
                  nodes: [
                    { commit: { statusCheckRollup: { state: "SUCCESS" } } },
                  ],
                },
              },
              p1: {
                headRefName: "feature/child",
                baseRefName: "feature/base",
                reviewDecision: "REVIEW_REQUIRED",
                reviewRequests: { totalCount: 0, nodes: [] },
                commits: {
                  nodes: [
                    { commit: { statusCheckRollup: { state: "PENDING" } } },
                  ],
                },
              },
            },
          },
        });
      if (command.includes("repos/acme/sidebar/stacks"))
        return JSON.stringify([
          [
            {
              number: 3,
              base: { ref: "main" },
              pull_requests: [
                {
                  number: 12,
                  state: "open",
                  draft: false,
                  head: { ref: "feature/base" },
                  base: { ref: "main" },
                  title: "Base layer",
                  html_url: "https://github.com/acme/sidebar/pull/12",
                  review_comments: 0,
                },
                {
                  number: 13,
                  state: "open",
                  draft: false,
                  head: { ref: "feature/child" },
                  base: { ref: "feature/base" },
                  title: "Child layer",
                  html_url: "https://github.com/acme/sidebar/pull/13",
                  review_comments: 0,
                },
              ],
            },
          ],
        ]);
      throw new Error(`unexpected GitHub command: ${command}`);
    });
    const handlers = createAuthoredPullRequestService(
      host.bb,
      lifecycle,
      { read, execute: vi.fn() } as unknown as GitHubCommandService,
    );

    const result = await handlers.sidebarAuthoredPullRequestStacks(null);
    const stackReads = read.mock.calls.filter(([args]) =>
      args.some((value) => value === "repos/acme/sidebar/stacks"),
    );
    expect(stackReads).toHaveLength(1);
    expect(stackReads[0]?.[0]).toContain("per_page=100");
    expect(stackReads[0]?.[0]).toContain("--paginate");
    expect(stackReads[0]?.[0]).toContain("--slurp");
    expect(stackReads[0]?.[0]).not.toContain("pull_request=12");
    expect(stackReads[0]?.[0]).not.toContain("pull_request=13");
    expect(result.pullRequests).toEqual([
      expect.objectContaining({
        number: 12,
        stack: expect.objectContaining({
          number: 3,
          pullRequests: [
            expect.objectContaining({ number: 12 }),
            expect.objectContaining({ number: 13 }),
          ],
        }),
      }),
      expect.objectContaining({
        number: 13,
        stack: expect.objectContaining({
          number: 3,
          pullRequests: [
            expect.objectContaining({ number: 12 }),
            expect.objectContaining({ number: 13 }),
          ],
        }),
      }),
    ]);
    expect(host.harness.inspection.logEntries).toEqual([]);
    await host.harness.lifecycle.dispose();
  });

  it("omits absent optional reviewer names from nested stack layers", async () => {
    const host = createFakePluginHost();
    const lifecycle = createServerLifecycle();
    const read = vi.fn(async (args: readonly string[]) => {
      const command = args.join(" ");
      if (args[0] === "search")
        return JSON.stringify([
          {
            number: 12,
            title: "Stack layer",
            url: "https://github.com/acme/sidebar/pull/12",
            repository: { nameWithOwner: "acme/sidebar" },
            state: "OPEN",
            isDraft: false,
          },
        ]);
      if (command.includes("isArchived"))
        return JSON.stringify({ data: { r0: { isArchived: false } } });
      if (command.includes("pullRequest(number"))
        return JSON.stringify({
          data: {
            repository: {
              p0: {
                headRefName: "feature/stack-layer",
                baseRefName: "main",
                reviewDecision: "REVIEW_REQUIRED",
                reviewRequests: { totalCount: 0, nodes: [] },
                commits: {
                  nodes: [
                    { commit: { statusCheckRollup: { state: "SUCCESS" } } },
                  ],
                },
              },
            },
          },
        });
      if (command.includes("repos/acme/sidebar/stacks"))
        return JSON.stringify([
          {
            number: 3,
            base: { ref: "main" },
            pull_requests: [
              {
                number: 12,
                state: "open",
                draft: false,
                head: { ref: "feature/stack-layer" },
                base: { ref: "main" },
                title: "Stack layer",
                html_url: "https://github.com/acme/sidebar/pull/12",
                review_comments: 0,
              },
            ],
          },
        ]);
      throw new Error(`unexpected GitHub command: ${command}`);
    });
    const commands = {
      read,
      execute: vi.fn(),
    } as unknown as GitHubCommandService;
    const handlers = createAuthoredPullRequestService(
      host.bb,
      lifecycle,
      commands,
    );

    const result = await handlers.sidebarAuthoredPullRequestStacks(null);
    expect(result).toMatchObject({
      available: true,
      pullRequests: [
        {
          stack: {
            pullRequests: [{ number: 12 }],
          },
        },
      ],
    });
    expect(result).toStrictEqual(JSON.parse(JSON.stringify(result)));
    await host.harness.lifecycle.dispose();
  });
});
