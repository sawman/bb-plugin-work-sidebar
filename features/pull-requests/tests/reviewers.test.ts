import { describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server";
import {
  REVIEWER_DIRECTORY_CACHE_MS,
  createPullRequestReviewerService,
  parseReviewerDirectory,
} from "../server-reviewers";
import type { GitHubCommandService } from "../server-github-read";
import { pullRequestReviewerRpcSchemas } from "../schemas";

describe("pull-request reviewer server service", () => {
  it("rejects malformed repositories, logins, and unknown wire fields", () => {
    expect(
      pullRequestReviewerRpcSchemas.getPullRequestReviewers.input.safeParse({
        repository: "missing-slash",
      }).success,
    ).toBe(false);
    expect(
      pullRequestReviewerRpcSchemas.updatePullRequestReviewers.input.safeParse({
        repository: "acme/sidebar",
        number: 42,
        reviewers: ["invalid login"],
      }).success,
    ).toBe(false);
    expect(
      pullRequestReviewerRpcSchemas.updatePullRequestReviewers.input.safeParse({
        repository: "acme/sidebar",
        number: 42,
        reviewers: ["octocat"],
        unknown: true,
      }).success,
    ).toBe(false);
  });

  it("projects, filters, deduplicates, and sorts write-capable collaborators", () => {
    expect(
      parseReviewerDirectory([
        [
          {
            login: "Zed",
            name: "Zed Example",
            avatar_url: "https://avatars.example/zed",
            permissions: { push: true },
          },
          {
            login: "reader",
            name: "Read Only",
            avatar_url: "https://avatars.example/reader",
            permissions: { push: false },
          },
        ],
        [
          {
            login: "alice",
            name: null,
            avatar_url: null,
            permissions: { push: true },
          },
          {
            login: "zed",
            name: "Duplicate",
            avatar_url: null,
            permissions: { push: true },
          },
          { malformed: true },
        ],
      ]),
    ).toEqual([
      { login: "alice", name: null, avatarUrl: null },
      {
        login: "Zed",
        name: "Zed Example",
        avatarUrl: "https://avatars.example/zed",
      },
    ]);
  });

  it("loads a repository directory through one 24-hour cached paginated read", async () => {
    const lifecycle = createServerLifecycle();
    const read = vi.fn(async () =>
      JSON.stringify([
        [
          {
            login: "octocat",
            name: "Octo Cat",
            avatar_url: "https://avatars.example/octocat",
            permissions: { push: true },
          },
        ],
      ]),
    );
    const service = createPullRequestReviewerService(lifecycle, {
      read,
      execute: vi.fn(),
    } as GitHubCommandService);

    await expect(service.list("acme/sidebar")).resolves.toEqual([
      {
        login: "octocat",
        name: "Octo Cat",
        avatarUrl: "https://avatars.example/octocat",
      },
    ]);
    expect(read).toHaveBeenCalledWith(
      [
        "api",
        "--method",
        "GET",
        "repos/acme/sidebar/collaborators?affiliation=all&per_page=100",
        "--paginate",
        "--slurp",
      ],
      4_000_000,
      REVIEWER_DIRECTORY_CACHE_MS,
    );
  });

  it("applies only the authoritative add/remove diff and skips a no-op", async () => {
    const lifecycle = createServerLifecycle();
    const onChanged = vi.fn();
    let current = ["alice", "bob"];
    let teams = ["platform"];
    const execute = vi.fn(async (args: readonly string[]) => {
      if (args[2] === "GET")
        return JSON.stringify({
          users: current.map((login) => ({ login })),
          teams: teams.map((slug) => ({ slug })),
        });
      if (args[2] === "POST") {
        current = [...current, "carol"];
        return "{}";
      }
      if (args[2] === "DELETE") {
        current = current.filter((login) => login !== "alice");
        teams = [];
        return "{}";
      }
      throw new Error(`unexpected command: ${args.join(" ")}`);
    });
    const service = createPullRequestReviewerService(
      lifecycle,
      { read: vi.fn(), execute } as GitHubCommandService,
      onChanged,
    );

    await expect(
      service.update("acme/sidebar", 42, ["bob", "carol"]),
    ).resolves.toEqual(["bob", "carol"]);
    expect(execute.mock.calls.map(([args]) => args)).toEqual([
      [
        "api",
        "--method",
        "GET",
        "repos/acme/sidebar/pulls/42/requested_reviewers",
      ],
      [
        "api",
        "--method",
        "POST",
        "repos/acme/sidebar/pulls/42/requested_reviewers",
        "--field",
        "reviewers[]=carol",
      ],
      [
        "api",
        "--method",
        "DELETE",
        "repos/acme/sidebar/pulls/42/requested_reviewers",
        "--field",
        "reviewers[]=alice",
        "--field",
        "team_reviewers[]=platform",
      ],
    ]);
    expect(onChanged).toHaveBeenCalledOnce();

    execute.mockClear();
    onChanged.mockClear();
    await expect(
      service.update("acme/sidebar", 42, ["CAROL", "bob", "bob"]),
    ).resolves.toEqual(["bob", "CAROL"]);
    expect(execute).toHaveBeenCalledOnce();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("clears stale projections after a partial mutation failure", async () => {
    const lifecycle = createServerLifecycle();
    lifecycle.cacheGitHubRead("stale", "value", Date.now() + 60_000);
    const onChanged = vi.fn();
    const execute = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({ users: [{ login: "alice" }], teams: [] }),
      )
      .mockResolvedValueOnce("{}")
      .mockRejectedValueOnce(new Error("remove failed"));
    const service = createPullRequestReviewerService(
      lifecycle,
      { read: vi.fn(), execute } as GitHubCommandService,
      onChanged,
    );

    await expect(service.update("acme/sidebar", 42, ["bob"])).rejects.toThrow(
      "remove failed",
    );
    expect(onChanged).toHaveBeenCalledOnce();
    expect(lifecycle.githubReadCache.size).toBe(0);
  });
});
