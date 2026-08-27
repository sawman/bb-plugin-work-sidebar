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

    await host.harness.lifecycle.dispose();
    expect(lifecycle.inspect()).toEqual({ disposed: true, timers: 0, subscriptions: 0, caches: 0 });
  });
});
