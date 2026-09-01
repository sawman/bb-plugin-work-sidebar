import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { createServerLifecycle } from "../../server";
import { rpcContract } from "../../contracts";
import { MAX_LEGACY_WORK_CACHE } from "../../server-lifecycle";

describe("R2 server registration and disposal", () => {
  it("bounds legacy probes with LRU expiry pruning without disturbing pending replacement isolation", async () => {
    const lifecycle = createServerLifecycle();
    const none = {
      state: "none" as const,
      taskIds: [],
      message: null,
    };
    for (let index = 0; index < MAX_LEGACY_WORK_CACHE; index += 1)
      await lifecycle.readLegacyWork(
        `thr_${index}\u0000proj_root`,
        5_000,
        async () => none,
      );
    await lifecycle.readLegacyWork(
      "thr_0\u0000proj_root",
      5_000,
      async () => none,
    );
    await lifecycle.readLegacyWork(
      "thr_overflow\u0000proj_root",
      5_000,
      async () => none,
    );
    expect(lifecycle.legacyWorkCache.size).toBe(MAX_LEGACY_WORK_CACHE);
    expect(lifecycle.legacyWorkCache.has("thr_0\u0000proj_root")).toBe(true);
    expect(lifecycle.legacyWorkCache.has("thr_1\u0000proj_root")).toBe(false);

    const refreshed = {
      state: "adoptable" as const,
      taskIds: ["task_refreshed"],
      message: "Legacy attachment changed while reading.",
    };
    let resolvePending!: (value: typeof none) => void;
    let pendingLoadCount = 0;
    const pendingKey = "thr_pending\u0000proj_root";
    const loadPending = vi.fn(() => {
      pendingLoadCount += 1;
      return pendingLoadCount === 1
        ? new Promise<typeof none>((resolve) => {
            resolvePending = resolve;
          })
        : Promise.resolve(refreshed);
    });
    const leader = lifecycle.readLegacyWork(pendingKey, 5_000, loadPending);
    const follower = lifecycle.readLegacyWork(pendingKey, 5_000, loadPending);
    await Promise.resolve();
    expect(loadPending).toHaveBeenCalledOnce();
    lifecycle.invalidateLegacyWork(pendingKey);
    resolvePending(none);
    await expect(leader).resolves.toEqual(refreshed);
    await expect(follower).resolves.toEqual(refreshed);
    expect(loadPending).toHaveBeenCalledTimes(2);
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
      await lifecycle.readLegacyWork(
        "thr_pruned\u0000proj_root",
        5_000,
        async () => none,
      );
    } finally {
      vi.useRealTimers();
    }
    expect(lifecycle.inspectLegacyWork()).toEqual({
      cached: 1,
      pending: 0,
      generations: 0,
    });
  });

  it("retries a stale pending legacy probe once, but still isolates disposal from a replacement lifecycle", async () => {
    const key = "thr_root\u0000proj_root";
    const adoptable = {
      state: "adoptable" as const,
      taskIds: ["task_legacy"],
      message: "One legacy top-level attachment can be explicitly adopted.",
    };
    const first = createServerLifecycle();
    const refreshed = {
      state: "adoptable" as const,
      taskIds: ["task_current"],
      message: "Fresh legacy attachment.",
    };
    let resolveFirst!: (value: typeof adoptable) => void;
    let firstLoadCount = 0;
    const loadFirst = vi.fn(() => {
      firstLoadCount += 1;
      return firstLoadCount === 1
        ? new Promise<typeof adoptable>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(refreshed);
    });
    const pendingFirst = first.readLegacyWork(key, 5_000, loadFirst);
    const followerFirst = first.readLegacyWork(key, 5_000, loadFirst);
    await Promise.resolve();
    expect(loadFirst).toHaveBeenCalledOnce();
    first.invalidateLegacyWork(key);
    resolveFirst(adoptable);
    await expect(pendingFirst).resolves.toEqual(refreshed);
    await expect(followerFirst).resolves.toEqual(refreshed);
    expect(loadFirst).toHaveBeenCalledTimes(2);
    expect(first.legacyWorkCache.get(key)?.value).toEqual(refreshed);

    let resolveRepeated!: (value: typeof adoptable) => void;
    let repeatedLoadCount = 0;
    const repeatedlyInvalidated = createServerLifecycle();
    const repeated = repeatedlyInvalidated.readLegacyWork(key, 5_000, () => {
      repeatedLoadCount += 1;
      return new Promise<typeof adoptable>((resolve) => {
        resolveRepeated = resolve;
      });
    });
    await Promise.resolve();
    repeatedlyInvalidated.invalidateLegacyWork(key);
    resolveRepeated(adoptable);
    await vi.waitFor(() => expect(repeatedLoadCount).toBe(2));
    repeatedlyInvalidated.invalidateLegacyWork(key);
    resolveRepeated(adoptable);
    await expect(repeated).rejects.toThrow(
      "Legacy work changed repeatedly while resolving. Retry the operation.",
    );
    await expect(repeated).rejects.not.toThrow(
      "Legacy work discovery was invalidated.",
    );

    const retiring = createServerLifecycle();
    let resolveRetiring!: (value: typeof adoptable) => void;
    const loadRetiring = vi.fn(
      () =>
        new Promise<typeof adoptable>((resolve) => {
          resolveRetiring = resolve;
        }),
    );
    const pendingRetiring = retiring.readLegacyWork(key, 5_000, loadRetiring);
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
    await expect(pendingRetiring).rejects.toThrow(
      "Legacy work discovery lifecycle is disposed.",
    );
    await expect(followerRetiring).rejects.toThrow(
      "Legacy work discovery lifecycle is disposed.",
    );
    expect(retiring.legacyWorkCache.size).toBe(0);
    expect(replacement.legacyWorkCache.get(key)?.value).toMatchObject({
      state: "none",
    });
  });

  it("keeps polling settings and the complete RPC shape while factory disposal clears runtime state", async () => {
    const host = createFakePluginHost();
    const lifecycle = createServerLifecycle();
    await plugin(host.bb, lifecycle);

    expect(host.harness.inspection.logEntries).toEqual([]);

    expect(
      Object.keys(host.harness.inspection.registrations.settingsDescriptors),
    ).toEqual([
      "githubActivePollSeconds",
      "githubBackgroundPollSeconds",
      "githubLeftListRefreshSeconds",
      "githubMaxRestPollsPerMinute",
      "stuckThreadMinutes",
    ]);
    expect(
      host.harness.inspection.registrations.settingsDescriptors
        .stuckThreadMinutes,
    ).toMatchObject({
      type: "select",
      default: "30",
      options: ["15", "30", "45", "60", "120"],
    });
    expect(host.harness.inspection.registrations.rpcMethods).toEqual([
      "getAgentDetails",
      "getChanges",
      "getChangesFingerprint",
      "checkoutStackBranch",
      "getWorkingTreeFileDiff",
      "getSidebarOrder",
      "saveSiblingOrder",
      "getLaterThreads",
      "saveLaterThreads",
      "getThreadGroups",
      "saveThreadGroups",
      "getSidebarAppearance",
      "saveSidebarAppearance",
      "moveSidebarThread",
      "sidebarTasks",
      "sidebarTaskLinks",
      "sidebarPullRequestStacks",
      "sidebarThreadPullRequests",
      "sidebarAuthoredPullRequests",
      "sidebarAuthoredPullRequestStacks",
      "setAuthoredPullRequestDraft",
      "getPullRequestReviewers",
      "updatePullRequestReviewers",
      "getRecycleBin",
      "binSidebarThread",
      "restoreBinnedSidebarThread",
      "expireRecycleBinThreads",
      "sidebarArchivedThreads",
      "unarchiveSidebarThread",
      "getWorkContext",
      "getWorkStatus",
      "getWorkOutcome",
      "getWorkGoal",
    "getWorkPlan",
    "getWorkItemQueue",
    "saveWorkItemQueue",
    "moveWorkItemToExecution",
    "getWorkBackgroundJobs",
      "getGitHubPollingPolicy",
      "getWorkTracker",
      "linkLinearIssue",
      "searchLinearIssues",
      "unlinkLinearIssue",
      "setPrimaryLinearIssue",
      "updateLinearIssueStatus",
      "getWorkProviderStatus",
      "getGitHubApiHealth",
      "getLatestActivity",
      "createWorkTask",
      "ensureOutcomeContext",
      "createExecutionTask",
      "bindExecutionOwner",
      "adoptLegacyOutcome",
      "updateWorkTask",
      "updateTaskStatus",
      "updateTaskAssignee",
      "createSidebarTask",
      "deleteSidebarTask",
      "attachTaskToThread",
      "detachTaskFromThread",
      "reorderTask",
    ]);
    expect(Object.keys(rpcContract)).toEqual(
      host.harness.inspection.registrations.rpcMethods,
    );
    await expect(
      host.harness.behavior.callRpc("getSidebarAppearance", null),
    ).resolves.toEqual({
      rowHeight: 40,
      textScale: 1,
      workingProviderAnimation: "slow-spin",
    });
    await expect(
      host.harness.behavior.callRpc("saveSidebarAppearance", {
        textScale: 0.9,
      }),
    ).resolves.toEqual({
      rowHeight: 40,
      textScale: 0.9,
      workingProviderAnimation: "slow-spin",
    });
    await expect(
      host.harness.behavior.callRpc("saveSidebarAppearance", {
        workingProviderAnimation: "sheen",
      }),
    ).resolves.toEqual({
      rowHeight: 40,
      textScale: 0.9,
      workingProviderAnimation: "sheen",
    });
    await expect(
      host.harness.behavior.callRpc("saveSidebarAppearance", {
        textScale: 1.11,
      }),
    ).rejects.toThrow("rpc input validation failed");
    await expect(
      host.harness.behavior.callRpc("moveSidebarThread", {
        threadId: "thr_source",
        parentThreadId: null,
        unexpected: true,
      } as never),
    ).rejects.toMatchObject({ code: "invalid_input" });

    lifecycle.githubReadCache.set("read", {
      expiresAt: Infinity,
      value: "cached",
    });
    lifecycle.githubReadPending.set("read", Promise.resolve("pending"));
    lifecycle.githubPullRequestSignalCache.set("signal", {
      expiresAt: Infinity,
      value: { checks: "passing", review: "approved" },
    });
    lifecycle.githubPullRequestSignalPending.set(
      "signal",
      Promise.resolve(null),
    );
    lifecycle.archivedThreadsCache = { expiresAt: Infinity, value: [] };
    lifecycle.archivedThreadsPending = Promise.resolve([]);
    lifecycle.githubGraphqlHealth = {
      state: "rate_limited",
      scope: "graphql",
      message: "limited",
      retryAt: 1,
    };
    lifecycle.githubRestHealth = {
      state: "unavailable",
      scope: "rest",
      message: "unavailable",
      retryAt: null,
    };
    lifecycle.githubGraphqlBackoffUntil = 1;
    expect(lifecycle.inspect()).toMatchObject({
      disposed: false,
      caches: 4,
      archived: true,
      backoffUntil: 1,
    });
    await host.harness.lifecycle.dispose();
    expect(lifecycle.inspect()).toEqual({
      disposed: true,
      caches: 0,
      archived: false,
      backoffUntil: 0,
    });
    lifecycle.dispose();
    expect(lifecycle.inspect()).toEqual({
      disposed: true,
      caches: 0,
      archived: false,
      backoffUntil: 0,
    });

    // A late cleanup targets the lifecycle captured by its request, never a
    // replacement generation that happens to be active by the time it settles.
    const replacement = createServerLifecycle();
    lifecycle.githubReadPending.set("same-key", Promise.resolve("old"));
    replacement.githubReadPending.set("same-key", Promise.resolve("new"));
    lifecycle.releasePending("githubRead", "same-key");
    expect(replacement.githubReadPending.has("same-key")).toBe(true);

    let resolveLate!: (value: string) => void;
    const late = new Promise<string>((resolve) => {
      resolveLate = resolve;
    });
    void late.then((value) =>
      lifecycle.cacheGitHubRead("late", value, Infinity),
    );
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

    await expect(
      host.harness.behavior.callRpc("sidebarAuthoredPullRequests", {
        force: false,
        unexpected: true,
        // Intentionally violates the strict RPC schema at the raw transport boundary.
      } as never),
    ).rejects.toMatchObject({
      code: "invalid_input",
      message: "rpc input validation failed",
    });

    first.githubReadCache.set("first", {
      expiresAt: Infinity,
      value: "cached",
    });
    first.githubReadPending.set("first", Promise.resolve("pending"));
    const second = createServerLifecycle();
    const replacement = await host.harness.lifecycle.reload((bb) =>
      plugin(bb, second),
    );

    expect(first.inspect()).toEqual({
      disposed: true,
      caches: 0,
      archived: false,
      backoffUntil: 0,
    });
    expect(second.inspect()).toEqual({
      disposed: false,
      caches: 0,
      archived: false,
      backoffUntil: 0,
    });
    await expect(
      host.harness.behavior.callRpc("getGitHubApiHealth", null),
    ).resolves.toMatchObject({
      state: "available",
      scope: "unknown",
      message: null,
      retryAt: null,
    });

    const third = createServerLifecycle();
    const finalGeneration = await replacement.harness.lifecycle.reload((bb) =>
      plugin(bb, third),
    );
    expect(second.inspect()).toEqual({
      disposed: true,
      caches: 0,
      archived: false,
      backoffUntil: 0,
    });
    await expect(
      finalGeneration.harness.behavior.callRpc("getGitHubApiHealth", null),
    ).resolves.toMatchObject({
      state: "available",
      scope: "unknown",
      message: null,
      retryAt: null,
    });

    await finalGeneration.harness.lifecycle.dispose();
    expect(third.inspect()).toEqual({
      disposed: true,
      caches: 0,
      archived: false,
      backoffUntil: 0,
    });
  });
});
