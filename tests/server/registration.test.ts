import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { createServerLifecycle } from "../../server";
import { rpcContract } from "../../contracts";

describe("R2 server registration and disposal", () => {
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
      "getSidebarOrder", "saveSiblingOrder", "getThreadListMode", "saveThreadListMode",
      "getLaterThreads", "saveLaterThreads", "getThreadGroups", "saveThreadGroups",
      "sidebarTasks", "sidebarTaskLinks", "sidebarPullRequestStacks", "sidebarThreadPullRequests",
      "sidebarAuthoredPullRequests", "sidebarAuthoredPullRequestStacks", "setAuthoredPullRequestDraft",
      "sidebarArchivedThreads", "unarchiveSidebarThread", "getWorkContext", "getWorkChanges",
      "getPullRequestFingerprint", "getGitHubPollingPolicy", "getWorkTracker", "getWorkProviderStatus",
      "getGitHubApiHealth", "checkoutStackBranch", "linkLinearIssue", "searchLinearIssues",
      "getLatestActivity", "getWorkingTreeFileDiff", "unlinkLinearIssue", "updateLinearIssueStatus",
      "createWorkTask", "ensureOutcomeContext", "createExecutionTask", "bindExecutionOwner",
      "adoptLegacyOutcome", "updateWorkTask", "updateTaskStatus", "updateTaskAssignee", "createSidebarTask",
      "deleteSidebarTask", "attachTaskToThread", "detachTaskFromThread", "reorderTask",
    ]);
    expect(Object.keys(rpcContract)).toEqual(host.harness.inspection.registrations.rpcMethods);

    lifecycle.githubReadCache.set("read", { expiresAt: Infinity, value: "cached" });
    lifecycle.githubReadPending.set("read", Promise.resolve("pending"));
    lifecycle.githubPullRequestSignalCache.set("signal", { expiresAt: Infinity, value: "cached" });
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
});
