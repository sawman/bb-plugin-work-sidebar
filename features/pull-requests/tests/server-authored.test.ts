import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server";
import { createAuthoredPullRequestService } from "../server-authored";
import type { GitHubCommandService } from "../server-github-read";

describe("authored pull-request stack wire projection", () => {
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
