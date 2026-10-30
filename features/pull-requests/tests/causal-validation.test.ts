import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server-lifecycle";
import { readGitHub } from "../../../shared/github/read-cache";
import { readGitHubSignals } from "../server-stack";
import { factFromPullRequest, mergeNativePullRequestFact, mergePullRequestFacts, nativeValidationDemands } from "../facts";
import { currentPr } from "../../changes/tests/latency-fixtures";
import type { GitHubApiRunner, GitHubSignal } from "../server-types";
import { createThreadStackService } from "../server-thread-stack";
import { withNativeStatusRpc } from "../../../tests/fixtures/native-status-rpc";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((complete) => { resolve = complete; }); return { promise, resolve }; }
function native(checks: "pending" | "passing" = "pending", title = "Native title") {
  const state = checks === "pending" ? "pending" : "passing";
  return factFromPullRequest({ ...currentPr(1, title),
    checks: { state, totalCount: 1, pendingCount: checks === "pending" ? 1 : 0, passedCount: checks === "passing" ? 1 : 0, failedCount: 0 },
    signal: { checks, review: "approved", reviewCommentCount: 0 },
    observations: Object.fromEntries(["title", "lifecycle", "head", "base", "checks", "checkCounts", "review", "mergeability"].map((group) =>
      [group, { source: "native", validatedAt: null, updatedAt: "2026-10-30T00:00:00Z" }])) });
}
function response(checks = "SUCCESS") {
  return JSON.stringify({ data: { repository: { p0: {
    title: "Validated title", url: currentPr(1).url, state: "OPEN", isDraft: false, updatedAt: "2026-10-30T00:00:00Z",
    headRefName: "feature/1", baseRefName: "main", headRefOid: "head", baseRefOid: "base",
    mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", isInMergeQueue: false,
    reviewDecision: "APPROVED", reviewRequests: { totalCount: 0, nodes: [] }, reviews: { totalCount: 0, nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: checks } } }] },
  } } } });
}
function publication(signal: GitHubSignal) {
  return factFromPullRequest({ ...currentPr(1),
    signal: { ...signal, reviewCommentCount: 0 }, observations: signal.observations,
    checks: { state: signal.checks === "pending" ? "pending" : "passing", totalCount: 0, pendingCount: 0, failedCount: 0, passedCount: 0 },
  });
}
afterEach(() => vi.useRealTimers());

describe("causal signal validation at the actual raw cache boundary", () => {
  it.each([-600_000, 0, 600_000])("client skew %i cannot make pre-demand cached data win; identical replay/title-only update costs zero", async (skew) => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const lifecycle = createServerLifecycle(); let checkState = "PENDING";
    const command = vi.fn(async () => response(checkState));
    const run: GitHubApiRunner = (args, buffer, policy) => readGitHub(lifecycle, command,
      () => ({ state: "unavailable", scope: "rest", message: "offline", retryAt: null }), args, buffer, 120_000, undefined, policy);
    try {
      await readGitHubSignals("acme", "repo", [1], lifecycle, run);
      vi.setSystemTime(100_000 + skew);
      const first = mergeNativePullRequestFact(undefined, native());
      const changed = mergeNativePullRequestFact(first, native("passing"));
      const demand = nativeValidationDemands(changed, "acme/repo#1")!;
      checkState = "SUCCESS"; vi.setSystemTime(100_001);
      const [left, right, third] = await Promise.all([1, 2, 3].map(() => readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demand })));
      expect(command).toHaveBeenCalledTimes(2);
      expect(left.get(1)).toEqual(right.get(1)); expect(right.get(1)).toEqual(third.get(1));
      const resolved = mergePullRequestFacts(changed, [publication(left.get(1)!)]);
      expect(resolved.facts["acme/repo#1"].signal.checks).toBe("passing");
      const replayed = mergeNativePullRequestFact(resolved, native("passing"));
      expect(replayed).toBe(resolved);
      const titleOnly = mergeNativePullRequestFact(replayed, native("passing", "Changed title"));
      expect(nativeValidationDemands(titleOnly, "acme/repo#1")).toEqual(demand);
      for (let count = 0; count < 5; count++) await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demand });
      expect(command).toHaveBeenCalledTimes(2);
    } finally { lifecycle.dispose(); }
  });

  it("rejects a delayed proof for the first A after native A→B→A, while consecutive A replay keeps the occurrence", async () => {
    const lifecycle = createServerLifecycle();
    const command = vi.fn(async () => response("SUCCESS"));
    const run: GitHubApiRunner = (args, buffer, policy) => readGitHub(lifecycle, command,
      () => ({ state: "unavailable", scope: "rest", message: null, retryAt: null }), args, buffer, 120_000, undefined, policy);
    try {
      const first = mergeNativePullRequestFact(undefined, native());
      const firstDemand = nativeValidationDemands(first, "acme/repo#1")!;
      const oldProof = (await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: firstDemand })).get(1)!;
      const next = mergeNativePullRequestFact(mergeNativePullRequestFact(first, native("passing")), native());
      expect(nativeValidationDemands(next, "acme/repo#1")?.checks?.occurrence).toBe(3);
      const late = mergePullRequestFacts(next, [publication(oldProof)]);
      expect(late.facts["acme/repo#1"].signal.checks).toBe("pending");
      expect(mergeNativePullRequestFact(late, native())).toBe(late);
      const currentDemand = nativeValidationDemands(next, "acme/repo#1")!;
      await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: currentDemand });
      const admitted = command.mock.calls.length;
      const replay = await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: firstDemand });
      expect(command).toHaveBeenCalledTimes(admitted);
      expect(replay.get(1)?.observations?.checks?.satisfies).toContainEqual(currentDemand.checks);
      expect(replay.get(1)?.observations?.checks?.satisfies).not.toContainEqual(firstDemand.checks);
    } finally { lifecycle.dispose(); }
  });

  it("coalesces three staggered windows during a flight into one successor", async () => {
    const lifecycle = createServerLifecycle();
    const firstRead = deferred<string>(); const secondRead = deferred<string>();
    const command = vi.fn().mockReturnValueOnce(firstRead.promise).mockReturnValueOnce(secondRead.promise);
    const run: GitHubApiRunner = (args, buffer, policy) => readGitHub(lifecycle, command,
      () => ({ state: "unavailable", scope: "rest", message: null, retryAt: null }), args, buffer, 120_000, undefined, policy);
    const demands = [1, 2, 3].map(() => nativeValidationDemands(mergeNativePullRequestFact(undefined, native()), "acme/repo#1")!);
    try {
      const reads = [readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demands[0]! })];
      await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());
      reads.push(readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demands[1]! }));
      await Promise.resolve();
      reads.push(readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demands[2]! }));
      firstRead.resolve(response());
      await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(2));
      secondRead.resolve(response());
      const results = await Promise.all(reads);
      expect(command).toHaveBeenCalledTimes(2);
      for (let index = 0; index < results.length; index++) {
        expect(results[index]!.get(1)?.observations?.checks?.satisfies).toContainEqual(demands[index]!.checks);
      }
      expect(lifecycle.githubPullRequestSignalPending.size).toBe(0);
    } finally { lifecycle.dispose(); }
  });

  it("three windows share the actual thread RPC core and receive their own proofs without retiring each other", async () => {
    const lifecycle = createServerLifecycle(); const firstRead = deferred<string>();
    let signalReads = 0;
    const command = vi.fn(async (args: readonly string[]) => {
      if (args[1] === "graphql" && args.join(" ").includes("statusCheckRollup")) {
        signalReads++; return signalReads === 1 ? firstRead.promise : response();
      }
      return args[1] === "graphql" ? response() : "[]";
    });
    const read: import("../server-types").GitHubReadRunner = (args, buffer, ttl = 120_000, identity, policy) => readGitHub(lifecycle, command,
      () => ({ state: "unavailable", scope: "rest", message: null, retryAt: null }), args, buffer, ttl, identity, policy);
    const hostRead = vi.fn(async () => ({ outcome: "available", pullRequest: {
      ...currentPr(1), headRefName: "feature/1", baseRefName: "main",
    } }));
    const service = createThreadStackService(withNativeStatusRpc({ sdk: {
      threads: { get: async () => ({ environmentId: "env" }) }, nativeStatus: { read: hostRead },
    } }) as never, lifecycle, read);
    const demands = [1, 2, 3].map(() => nativeValidationDemands(mergeNativePullRequestFact(undefined, native()), "acme/repo#1")!);
    try {
      const a = service.sidebarThreadPullRequests({ threadIds: ["thr_a"], validationRequirements: { "acme/repo#1": demands[0]! } });
      await vi.waitFor(() => expect(signalReads).toBe(1));
      const b = service.summary("thr_a", { "acme/repo#1": demands[1]! });
      await Promise.resolve();
      const c = service.sidebarThreadPullRequests({ threadIds: ["thr_a"], validationRequirements: { "acme/repo#1": demands[2]! } });
      firstRead.resolve(response());
      const [left, right, third] = await Promise.all([a, b, c]);
      expect(left.available).toBe(true); expect(third.available).toBe(true);
      const entries = [left.pullRequests.thr_a, right.currentPullRequest, third.pullRequests.thr_a];
      for (let index = 0; index < entries.length; index++)
        expect(entries[index]?.observations?.checks?.satisfies).toContainEqual(demands[index]!.checks);
      expect(hostRead).toHaveBeenCalledOnce();
      expect(signalReads).toBe(2);
    } finally { lifecycle.dispose(); }
  });

  it("keeps an unsatisfied demand bounded through backoff and satisfies it on the next existing read", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const lifecycle = createServerLifecycle();
    const command = vi.fn(async () => response());
    const run: GitHubApiRunner = (args, buffer, policy) => readGitHub(lifecycle, command,
      () => ({ state: "unavailable", scope: "rest", message: null, retryAt: null }), args, buffer, 120_000, undefined, policy);
    const directory = mergeNativePullRequestFact(undefined, native());
    const demand = nativeValidationDemands(directory, "acme/repo#1")!;
    lifecycle.githubGraphqlBackoffUntil = 200_000;
    lifecycle.githubRestHealth = { state: "rate_limited", scope: "rest", retryAt: 200_000, message: "API rate limited" };
    try {
      await expect(readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demand })).rejects.toThrow(/unavailable/);
      expect(command).not.toHaveBeenCalled();
      expect(lifecycle.githubPullRequestSignalPending.size).toBe(0);
      expect(directory.facts["acme/repo#1"].observations?.checks?.validatedAt).toBeNull();
      expect(nativeValidationDemands(directory, "acme/repo#1")).toEqual(demand);
      vi.setSystemTime(200_001);
      const signals = await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demand });
      expect(signals.get(1)?.observations?.checks?.satisfies).toContainEqual(demand.checks);
      expect(command).toHaveBeenCalledOnce();
    } finally { lifecycle.dispose(); }
  });

  it("a new checks occurrence leaves review, people, mergeability and title observations unchanged", async () => {
    const lifecycle = createServerLifecycle();
    const command = vi.fn(async () => response());
    const run: GitHubApiRunner = (args, buffer, policy) => readGitHub(lifecycle, command,
      () => ({ state: "unavailable", scope: "rest", message: null, retryAt: null }), args, buffer, 120_000, undefined, policy);
    try {
      const first = mergeNativePullRequestFact(undefined, native());
      const demand = nativeValidationDemands(first, "acme/repo#1")!;
      const signals = await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demand });
      const observed = mergePullRequestFacts(first, [publication(signals.get(1)!)]);
      const checksChanged = mergeNativePullRequestFact(observed, native("passing"));
      for (const group of ["title", "review", "people", "mergeability"] as const)
        expect(checksChanged.facts["acme/repo#1"].observations?.[group]).toEqual(observed.facts["acme/repo#1"].observations?.[group]);
      expect(checksChanged.facts["acme/repo#1"].observations?.checks?.native?.occurrence).toBe(2);
    } finally { lifecycle.dispose(); }
  });
});
