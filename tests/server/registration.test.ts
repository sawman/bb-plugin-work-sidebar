import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, {
  createServerLifecycle,
  MAX_LEGACY_WORK_CACHE,
} from "../../server";
import { rpcContract } from "../../contracts";

describe("R2 server registration and disposal", () => {
  it("bounds legacy probes with LRU expiry pruning without disturbing pending replacement isolation", async () => {
    const lifecycle = createServerLifecycle();
    const none = {
      state: "none" as const,
      taskIds: [],
      message: null,
    };
    for (let index = 0; index < MAX_LEGACY_WORK_CACHE; index += 1)
      await lifecycle.readLegacyWork(`thr_${index}\u0000proj_root`, 5_000, async () => none);
    await lifecycle.readLegacyWork("thr_0\u0000proj_root", 5_000, async () => none);
    await lifecycle.readLegacyWork("thr_overflow\u0000proj_root", 5_000, async () => none);
    expect(lifecycle.legacyWorkCache.size).toBe(MAX_LEGACY_WORK_CACHE);
    expect(lifecycle.legacyWorkCache.has("thr_0\u0000proj_root")).toBe(true);
    expect(lifecycle.legacyWorkCache.has("thr_1\u0000proj_root")).toBe(false);

    let resolvePending!: (value: typeof none) => void;
    const pendingKey = "thr_pending\u0000proj_root";
    const loadPending = vi.fn(
      () => new Promise<typeof none>((resolve) => { resolvePending = resolve; }),
    );
    const leader = lifecycle.readLegacyWork(pendingKey, 5_000, loadPending);
    const follower = lifecycle.readLegacyWork(pendingKey, 5_000, loadPending);
    await Promise.resolve();
    expect(loadPending).toHaveBeenCalledOnce();
    lifecycle.invalidateLegacyWork(pendingKey);
    await lifecycle.readLegacyWork(pendingKey, 5_000, async () => none);
    resolvePending(none);
    await expect(leader).rejects.toThrow("Legacy work discovery was invalidated.");
    await expect(follower).rejects.toThrow("Legacy work discovery was invalidated.");
    expect(lifecycle.legacyWorkCache.size).toBe(MAX_LEGACY_WORK_CACHE);
    expect(lifecycle.legacyWorkCache.has(pendingKey)).toBe(true);
    expect(lifecycle.inspectLegacyWork()).toEqual({
      cached: MAX_LEGACY_WORK_CACHE,
      pending: 0,
      generations: 0,
    });

    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(5_001);
      await lifecycle.readLegacyWork("thr_pruned\u0000proj_root", 5_000, async () => none);
    } finally {
      vi.useRealTimers();
    }
    expect(lifecycle.inspectLegacyWork()).toEqual({
      cached: 1,
      pending: 0,
      generations: 0,
    });
  });

  it("rejects stale pending legacy probes after invalidation or disposal without leaking into a replacement lifecycle", async () => {
    const key = "thr_root\u0000proj_root";
    const adoptable = {
      state: "adoptable" as const,
      taskIds: ["task_legacy"],
      message: "One legacy top-level attachment can be explicitly adopted.",
    };
    const first = createServerLifecycle();
    let resolveFirst!: (value: typeof adoptable) => void;
    const loadFirst = vi.fn(
      () => new Promise<typeof adoptable>((resolve) => { resolveFirst = resolve; }),
    );
    const pendingFirst = first.readLegacyWork(
      key,
      5_000,
      loadFirst,
    );
    const followerFirst = first.readLegacyWork(key, 5_000, loadFirst);
    await Promise.resolve();
    expect(loadFirst).toHaveBeenCalledOnce();
    first.invalidateLegacyWork(key);
    await expect(
      first.readLegacyWork(key, 5_000, async () => ({
        state: "none" as const,
        taskIds: [],
        message: null,
      })),
    ).resolves.toMatchObject({ state: "none" });
    resolveFirst(adoptable);
    await expect(pendingFirst).rejects.toThrow("Legacy work discovery was invalidated.");
    await expect(followerFirst).rejects.toThrow("Legacy work discovery was invalidated.");
    expect(first.legacyWorkCache.get(key)?.value).toMatchObject({ state: "none" });

    const retiring = createServerLifecycle();
    let resolveRetiring!: (value: typeof adoptable) => void;
    const loadRetiring = vi.fn(
      () => new Promise<typeof adoptable>((resolve) => { resolveRetiring = resolve; }),
    );
    const pendingRetiring = retiring.readLegacyWork(
      key,
      5_000,
      loadRetiring,
    );
    const followerRetiring = retiring.readLegacyWork(key, 5_000, loadRetiring);
    await Promise.resolve();
    expect(loadRetiring).toHaveBeenCalledOnce();
    retiring.dispose();
    const replacement = createServerLifecycle();
    await replacement.readLegacyWork(key, 5_000, async () => ({
      state: "none" as const,
      taskIds: [],
      message: null,
    }));
    resolveRetiring(adoptable);
    await expect(pendingRetiring).rejects.toThrow("Legacy work discovery lifecycle is disposed.");
    await expect(followerRetiring).rejects.toThrow("Legacy work discovery lifecycle is disposed.");
    expect(retiring.legacyWorkCache.size).toBe(0);
    expect(replacement.legacyWorkCache.get(key)?.value).toMatchObject({ state: "none" });
  });

  it("keeps polling settings and the complete RPC shape while factory disposal clears runtime state", async () => {
    const host = createFakePluginHost();
    const lifecycle = createServerLifecycle();
    await plugin(host.bb, lifecycle);

    expect(Object.keys(host.harness.inspection.registrations.settingsDescriptors)).toEqual([
      "githubActivePollSeconds",
      "githubBackgroundPollSeconds",
      "githubLeftListRefreshSeconds",
      "githubMaxRestPollsPerMinute",
    ]);
    expect(host.harness.inspection.registrations.rpcMethods).toEqual([
      "getChanges", "getChangesFingerprint", "checkoutStackBranch", "getWorkingTreeFileDiff",
      "getSidebarOrder", "saveSiblingOrder", "getThreadListMode", "saveThreadListMode",
      "getLaterThreads", "saveLaterThreads", "getThreadGroups", "saveThreadGroups",
      "sidebarTasks", "sidebarTaskLinks", "sidebarPullRequestStacks", "sidebarThreadPullRequests",
      "sidebarAuthoredPullRequests", "sidebarAuthoredPullRequestStacks", "setAuthoredPullRequestDraft",
      "sidebarArchivedThreads", "unarchiveSidebarThread", "getWorkContext", "getWorkStatus", "getWorkOutcome", "getWorkGoal", "getWorkPlan", "getGitHubPollingPolicy", "getWorkTracker", "linkLinearIssue", "searchLinearIssues", "unlinkLinearIssue", "updateLinearIssueStatus", "getWorkProviderStatus",
      "getGitHubApiHealth", "getLatestActivity",
      "createWorkTask", "ensureOutcomeContext", "createExecutionTask", "bindExecutionOwner",
      "adoptLegacyOutcome", "updateWorkTask", "updateTaskStatus", "updateTaskAssignee", "createSidebarTask",
      "deleteSidebarTask", "attachTaskToThread", "detachTaskFromThread", "reorderTask",
    ]);
    expect(Object.keys(rpcContract)).toEqual(host.harness.inspection.registrations.rpcMethods);

    lifecycle.githubReadCache.set("read", { expiresAt: Infinity, value: "cached" });
    lifecycle.githubReadPending.set("read", Promise.resolve("pending"));
    lifecycle.githubPullRequestSignalCache.set("signal", { expiresAt: Infinity, value: { checks: "passing", review: "approved" } });
    lifecycle.githubPullRequestSignalPending.set("signal", Promise.resolve(null));
    lifecycle.archivedThreadsCache = { expiresAt: Infinity, value: [] };
    lifecycle.archivedThreadsPending = Promise.resolve([]);
    lifecycle.githubGraphqlHealth = { state: "rate_limited", scope: "graphql", message: "limited", retryAt: 1 };
    lifecycle.githubRestHealth = { state: "unavailable", scope: "rest", message: "unavailable", retryAt: null };
    lifecycle.githubGraphqlBackoffUntil = 1;
    expect(lifecycle.inspect()).toMatchObject({ disposed: false, caches: 4, archived: true, backoffUntil: 1 });
    await host.harness.lifecycle.dispose();
    expect(lifecycle.inspect()).toEqual({ disposed: true, caches: 0, archived: false, backoffUntil: 0 });
    lifecycle.dispose();
    expect(lifecycle.inspect()).toEqual({ disposed: true, caches: 0, archived: false, backoffUntil: 0 });

    // A late cleanup targets the lifecycle captured by its request, never a
    // replacement generation that happens to be active by the time it settles.
    const replacement = createServerLifecycle();
    lifecycle.githubReadPending.set("same-key", Promise.resolve("old"));
    replacement.githubReadPending.set("same-key", Promise.resolve("new"));
    lifecycle.releasePending("githubRead", "same-key");
    expect(replacement.githubReadPending.has("same-key")).toBe(true);

    let resolveLate!: (value: string) => void;
    const late = new Promise<string>((resolve) => { resolveLate = resolve; });
    void late.then((value) => lifecycle.cacheGitHubRead("late", value, Infinity));
    lifecycle.dispose();
    resolveLate("late value");
    await late;
    await Promise.resolve();
    expect(lifecycle.githubReadCache.size).toBe(0);
    expect(replacement.githubReadCache.size).toBe(0);
  });

  it("rejects surplus RPC JSON and replaces complete factory generations without retaining their state", async () => {
    const host = createFakePluginHost();
    const first = createServerLifecycle();
    await plugin(host.bb, first);

    await expect(host.harness.behavior.callRpc("sidebarAuthoredPullRequests", {
      force: false,
      unexpected: true,
      // Intentionally violates the strict RPC schema at the raw transport boundary.
    } as never)).rejects.toMatchObject({ code: "invalid_input", message: "rpc input validation failed" });

    first.githubReadCache.set("first", { expiresAt: Infinity, value: "cached" });
    first.githubReadPending.set("first", Promise.resolve("pending"));
    const second = createServerLifecycle();
    const replacement = await host.harness.lifecycle.reload((bb) => plugin(bb, second));

    expect(first.inspect()).toEqual({ disposed: true, caches: 0, archived: false, backoffUntil: 0 });
    expect(second.inspect()).toEqual({ disposed: false, caches: 0, archived: false, backoffUntil: 0 });
    await expect(host.harness.behavior.callRpc("getGitHubApiHealth", null)).resolves.toEqual({
      state: "available", scope: "unknown", message: null, retryAt: null,
    });

    const third = createServerLifecycle();
    const finalGeneration = await replacement.harness.lifecycle.reload((bb) => plugin(bb, third));
    expect(second.inspect()).toEqual({ disposed: true, caches: 0, archived: false, backoffUntil: 0 });
    await expect(finalGeneration.harness.behavior.callRpc("getGitHubApiHealth", null)).resolves.toEqual({
      state: "available", scope: "unknown", message: null, retryAt: null,
    });

    await finalGeneration.harness.lifecycle.dispose();
    expect(third.inspect()).toEqual({ disposed: true, caches: 0, archived: false, backoffUntil: 0 });
  });
});
