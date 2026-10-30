import { normalizeRpcJsonResult } from "@get-bb/plugin-sdk/internal/host-policy";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server-lifecycle";
import { readGitHub } from "../../../shared/github/read-cache";
import { withNativeStatusRpc } from "../../../tests/fixtures/native-status-rpc";
import { createAuthoredPullRequestService } from "../server-authored";
import { createThreadStackService } from "../server-thread-stack";
import { createRepositoryTopologyReader } from "../remote-topology-server";
import { readGitHubReviewCommentObservations } from "../server-stack";
import type { GitHubReadRunner } from "../server-types";

// Validate the original object with the same validator as the host RPC result
// boundary. A JSON round-trip would hide own properties whose value is undefined.
function strictRpcResult(value: unknown) {
  return normalizeRpcJsonResult(value, (failure) => { throw new Error(failure.message); });
}

const url = "https://github.com/acme/repo/pull/1";
const updatedAt = "2026-10-30T00:00:00Z";
const sample = {
  title: "PR", url, state: "OPEN", isDraft: false, updatedAt,
  headRefName: "feature", baseRefName: "main", headRefOid: "sha", baseRefOid: "base",
  mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", isInMergeQueue: false,
  reviewDecision: "APPROVED", reviewRequests: { totalCount: 0, nodes: [] }, reviews: { totalCount: 0, nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
};
const cases = ["graphql", "rest", "rest-no-sequence", "rest-review-no-sequence", "comments-no-sequence"] as const;
type Scenario = typeof cases[number];

function fixture(scenario: Scenario) {
  const host = createFakePluginHost();
  const lifecycle = createServerLifecycle();
  const command = vi.fn(async (args: readonly string[]) => {
    const query = args.join(" ");
    const target = args.find((arg) => arg.startsWith("repos/")) ?? "";
    if (args[0] === "search") return JSON.stringify([{ number: 1, title: "PR", url, repository: { nameWithOwner: "acme/repo" }, state: "OPEN", isDraft: false, updatedAt }]);
    if (query.includes("isArchived")) return JSON.stringify({ data: { r0: { isArchived: false } } });
    if (args[1] === "graphql") {
      const value = query.includes("reviewThreads")
        ? scenario === "comments-no-sequence" ? { ...sample, reviewThreads: { totalCount: 1, nodes: [{ isResolved: false, comments: { totalCount: 2 } }] } } : null
        : scenario.startsWith("rest") ? null : sample;
      return JSON.stringify({ data: { repository: { p0: value } } });
    }
    if (target.includes("/stacks")) return JSON.stringify([{ number: 7, base: { ref: "main" }, pull_requests: [{ number: 1, state: "open", draft: false, title: "PR", html_url: url, head: { ref: "feature" }, base: { ref: "main" } }] }]);
    if (target.includes("/reviews")) return "[]";
    if (target.includes("/check-runs")) return JSON.stringify({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success", head_sha: "sha" }] });
    if (target.includes("/status?")) return JSON.stringify({ total_count: 0, sha: "sha", statuses: [] });
    if (target.includes("/files")) return "[]";
    if (target.includes("/pulls/1")) return JSON.stringify({ number: 1, title: "PR", state: "open", draft: false, updated_at: updatedAt, html_url: url,
      head: { ref: "feature", sha: "sha" }, base: { ref: "main", sha: "base" }, requested_reviewers: [], requested_teams: [], review_comments: 0 });
    throw new Error(`Unexpected command: ${query}`);
  });
  const read: GitHubReadRunner = async (args, buffer, ttl = 120_000, identity, policy) => {
    const target = args.find((arg) => arg.startsWith("repos/")) ?? "";
    const sequenceLess = scenario === "rest-no-sequence" && /\/(pulls|commits)\//.test(target)
      || scenario === "rest-review-no-sequence" && target.includes("/reviews")
      || scenario === "comments-no-sequence" && args.join(" ").includes("reviewThreads");
    const cacheKey = args.join("\u0000");
    if (sequenceLess && !lifecycle.githubReadCache.has(cacheKey)) {
      // Exercise the real cache's optional-sequence path, not an adapter that
      // invents a new validation when it returns an old source response.
      lifecycle.cacheGitHubRead(cacheKey, await command(args), Date.now() + ttl, Date.now());
    }
    return readGitHub(lifecycle, command, () => ({ state: "unavailable", scope: "rest", message: null, retryAt: null }), args, buffer, ttl, identity, policy);
  };
  const bb = withNativeStatusRpc({ ...host.bb, sdk: { ...host.bb.sdk,
    threads: { ...host.bb.sdk.threads, get: async () => ({ environmentId: "env" }) },
    nativeStatus: { read: async () => ({ outcome: "available", pullRequest: {
      number: 1, title: "PR", url, state: "open", headRefName: "feature", baseRefName: "main", updatedAt,
      checks: { state: "pending", totalCount: 1, passedCount: 0, pendingCount: 1, failedCount: 0 },
      review: { state: "none", reviewRequestCount: 0 }, attention: "checks_pending",
      mergeability: { state: "mergeable", mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" },
    } }) },
  } });
  const topology = createRepositoryTopologyReader(lifecycle, read);
  const thread = createThreadStackService(bb as never, lifecycle, read, undefined, topology);
  const authored = createAuthoredPullRequestService(host.bb, lifecycle, { read, execute: vi.fn() }, topology);
  return { lifecycle, host, thread, authored };
}

describe("PR observation envelopes at the strict host JSON RPC boundary", () => {
  it.each([undefined, () => null, NaN, Infinity])("rejects non-JSON own properties (%s) instead of silently stripping them", (invalid) => {
    expect(() => strictRpcResult({ observations: { checks: { evidence: invalid } } })).toThrow(/\$result.observations.checks.evidence/);
  });

  for (const scenario of cases) {
    it.each(["thread", "summary", "projection", "authored", "authored-stack"] as const)(`${scenario}: %s publishes only JSON-valued groups and evidence`, async (surface) => {
      const { lifecycle, host, thread, authored } = fixture(scenario);
      try {
        const result = surface === "thread" ? await thread.sidebarThreadPullRequests({ threadIds: ["thr"] })
          : surface === "summary" ? await thread.summary("thr")
            : surface === "projection" ? await thread.projection("thr")
              : surface === "authored" ? await authored.sidebarAuthoredPullRequests({})
                : await authored.sidebarAuthoredPullRequestStacks(null);
        const entry = "currentPullRequest" in result ? result.currentPullRequest
          : Array.isArray(result.pullRequests) ? result.pullRequests[0] : result.pullRequests.thr;
        expect(entry).toBeTruthy();
        expect(entry?.observations?.checks?.source).toBe("github");
        expect(() => strictRpcResult(result)).not.toThrow();
        if (scenario === "graphql" && entry && "signal" in entry) {
          expect(entry.signal.checks).toBe("passing");
          expect(Object.hasOwn(entry.observations!, "checkCounts")).toBe(false);
          expect(entry.checks.totalCount).toBe(0);
        }
        if (scenario === "rest-no-sequence" || scenario === "rest-review-no-sequence") {
          expect(Object.hasOwn(entry!.observations!.review!, "sequence")).toBe(false);
          expect(Object.hasOwn(entry!.observations!.review!, "satisfies")).toBe(false);
          if (scenario === "rest-no-sequence") expect(Object.hasOwn(entry!.observations!.checks!, "sequence")).toBe(false);
          else expect(typeof entry!.observations!.checks!.sequence).toBe("number");
        }
        if (scenario === "comments-no-sequence" && entry && "signal" in entry) {
          expect(entry.signal.reviewCommentCount).toBe(2);
          expect(entry.observations?.comments).toBeTruthy();
          expect(Object.hasOwn(entry.observations!.comments!, "sequence")).toBe(false);
        }
      } finally { lifecycle.dispose(); await host.harness.lifecycle.dispose(); }
    });
  }

  it.each(["graphql", "rest"] as const)("%s preserves valid causal proof without inventing a count observation", async (scenario) => {
    const { lifecycle, host, thread } = fixture(scenario);
    const demand = { client: "transport-client", occurrence: 1, fingerprint: JSON.stringify(["acme/repo#1", "checks", ["passing", 1, 1, 0, 0]]) };
    try {
      const result = await thread.sidebarThreadPullRequests({ threadIds: ["thr"], validationRequirements: { "acme/repo#1": { checks: demand } } });
      const entry = result.pullRequests.thr!;
      expect(entry.observations?.checks?.satisfies).toEqual([demand]);
      if (scenario === "rest") expect(entry.observations?.checkCounts?.satisfies).toEqual([demand]);
      else expect(Object.hasOwn(entry.observations!, "checkCounts")).toBe(false);
      expect(() => strictRpcResult(result)).not.toThrow();
    } finally { lifecycle.dispose(); await host.harness.lifecycle.dispose(); }
  });

  it("omits optional epoch and sequence from an uninstrumented comments observation", async () => {
    const comments = await readGitHubReviewCommentObservations("acme", "repo", [1], async () => JSON.stringify({ data: { repository: { p0: {
      ...sample, reviewThreads: { totalCount: 0, nodes: [] },
    } } } }));
    expect(comments.get(1)?.counts).toEqual({ unresolved: 0, resolved: 0 });
    expect(() => strictRpcResult(comments.get(1))).not.toThrow();
  });
});
