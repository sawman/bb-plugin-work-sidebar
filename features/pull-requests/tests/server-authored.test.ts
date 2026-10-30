import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server";
import { createAuthoredPullRequestService } from "../server-authored";
import type { GitHubCommandService } from "../server-github-read";
import { readGitHub } from "../../../shared/github/read-cache";
import { createRepositoryTopologyReader } from "../remote-topology-server";

describe("authored pull-request stack wire projection", () => {
  it("keeps cached search title/lifecycle age separate from newly observed sparse topology head/base", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const host = createFakePluginHost(); const lifecycle = createServerLifecycle();
    let head = "old/head";
    const command = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "search") return JSON.stringify([{ number: 1, title: "Search title", url: "https://github.com/acme/repo/pull/1",
        repository: { nameWithOwner: "acme/repo" }, state: "OPEN", isDraft: false }]);
      if (args[3]?.includes("stacks")) return JSON.stringify([{ number: 7, base: { ref: "main" }, pull_requests: [{ number: 1, state: "open", draft: false,
        html_url: "https://github.com/acme/repo/pull/1", head: { ref: head }, base: { ref: "main" } }] }]);
      if (args.join(" ").includes("isArchived")) return JSON.stringify({ data: { r0: { isArchived: false } } });
      return JSON.stringify({ data: { repository: { p0: { headRefName: "old/head", baseRefName: "main", headRefOid: "old-sha", baseRefOid: "base",
        reviewDecision: "APPROVED", reviews: { totalCount: 0, nodes: [] }, reviewRequests: { totalCount: 0, nodes: [] }, commits: { nodes: [] } } } } });
    });
    const read: GitHubCommandService["read"] = (args, buffer, ttl = 120_000, identity, policy) => readGitHub(lifecycle, command,
      () => ({ state: "unavailable", scope: "rest", message: null, retryAt: null }), args, buffer, ttl, identity, policy);
    const handlers = createAuthoredPullRequestService(host.bb, lifecycle, { read, execute: vi.fn() }, createRepositoryTopologyReader(lifecycle, read));
    try {
      await handlers.sidebarAuthoredPullRequests({});
      vi.setSystemTime(150_000); head = "new/head";
      const result = await handlers.sidebarAuthoredPullRequestStacks(null);
      expect(result.pullRequests[0]).toMatchObject({ title: "Search title", head: "new/head" });
      expect(result.pullRequests[0]?.observations?.title?.validatedAt).toBe(100_000);
      expect(result.pullRequests[0]?.observations?.head?.validatedAt).toBe(150_000);
      expect(command.mock.calls.filter(([args]) => args[0] === "search")).toHaveLength(1);
    } finally { lifecycle.dispose(); await host.harness.lifecycle.dispose(); vi.useRealTimers(); }
  });
  it("uses a validated configured GitHub login and clears authored caches when it changes", async () => {
    const host = createFakePluginHost({
      settings: { githubAuthoredLogin: "octocat" },
    });
    const lifecycle = createServerLifecycle();
    const read = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "search") return "[]";
      throw new Error(`unexpected GitHub command: ${args.join(" ")}`);
    });
    const handlers = createAuthoredPullRequestService(
      host.bb,
      lifecycle,
      { read, execute: vi.fn() } as unknown as GitHubCommandService,
    );

    await expect(
      handlers.sidebarAuthoredPullRequests({ force: false }),
    ).resolves.toMatchObject({ available: true, pullRequests: [] });
    expect(read).toHaveBeenLastCalledWith(
      expect.arrayContaining(["--author", "octocat"]),
      12_000_000,
      expect.any(Number),
      undefined,
      expect.objectContaining({ onValidation: expect.any(Function) }),
    );

    await host.harness.behavior.setSettings({
      githubAuthoredLogin: "hubot",
    });
    await expect(
      handlers.sidebarAuthoredPullRequests({ force: false }),
    ).resolves.toMatchObject({ available: true, pullRequests: [] });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(
      expect.arrayContaining(["--author", "hubot"]),
      12_000_000,
      expect.any(Number),
      undefined,
      expect.objectContaining({ onValidation: expect.any(Function) }),
    );

    await expect(
      host.harness.behavior.setSettings({ githubAuthoredLogin: "-invalid" }),
    ).rejects.toThrow(/GitHub login/i);
    await host.harness.lifecycle.dispose();
  });

  it("uses the active GitHub CLI identity when no login is configured", async () => {
    const host = createFakePluginHost();
    const lifecycle = createServerLifecycle();
    const read = vi.fn(async () => "[]");
    const handlers = createAuthoredPullRequestService(
      host.bb,
      lifecycle,
      { read, execute: vi.fn() } as unknown as GitHubCommandService,
    );

    await handlers.sidebarAuthoredPullRequests({ force: false });
    expect(read).toHaveBeenCalledWith(
      expect.arrayContaining(["--author", "@me"]),
      12_000_000,
      expect.any(Number),
      undefined,
      expect.objectContaining({ onValidation: expect.any(Function) }),
    );
    await host.harness.lifecycle.dispose();
  });

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

  it("preserves explicit empty reviewer lists and JSON field presence in nested stack layers", async () => {
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
            pullRequests: [{ number: 12, requestedReviewers: [] }],
          },
        },
      ],
    });
    expect(result).toStrictEqual(JSON.parse(JSON.stringify(result)));
    await host.harness.lifecycle.dispose();
  });
});
