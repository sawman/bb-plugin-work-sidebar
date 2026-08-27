// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
const taskResult = { available: true, tasks: [], projects: [], error: null };
const aggregate = { tasksAvailable: true, currentThread: { title: "Thread", status: "idle" as const, runtimeStatus: "idle", providerId: "codex" }, tasks: [], subtasks: [], outcome: null, executionTasks: [], bindings: [], legacy: { state: "none" as const, taskIds: [], message: null }, goal: null, todos: [], activity: { latest: null, lastUser: null, current: null }, children: [], currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null, repository: { outcome: "absent" as const, message: null, branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] }, tracker: { visible: false, available: false, message: null, suggestions: [], item: null, statusOptions: [] } };
const status = { currentThread: aggregate.currentThread, children: [], activity: aggregate.activity };
const outcome = { tasksAvailable: true, outcome: null, executionTasks: [], bindings: [] };

function fixture(overrides: Partial<Rpc> = {}): Rpc {
  return { sidebarTasks: () => taskResult, sidebarTaskLinks: () => ({ available: true, links: {}, error: null }), getWorkContext: () => aggregate, getWorkChanges: () => ({ currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null, repository: aggregate.repository }), getWorkTracker: () => aggregate.tracker, getWorkProviderStatus: () => ({ tone: "green", providerId: "codex", providerName: "Codex", statusUrl: null, status: "ready", message: null }), getGitHubApiHealth: () => ({ state: "available", scope: "unknown", message: null, retryAt: null }), getWorkStatus: () => status, getWorkOutcome: () => outcome, getWorkGoal: () => null, getWorkPlan: () => ({ items: [] }), ...overrides } as Rpc;
}

describe("registered Work context cards", () => {
  it("isolates an Outcome RPC failure without blanking Status, Tasks, Goal, or Plan", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const failedOutcome = vi.fn().mockRejectedValue(new Error("outcome unavailable"));
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_one", params: null }, { rpc: fixture({ getWorkOutcome: failedOutcome }) });
    await waitFor(() => expect(slot.getByText("outcome unavailable")).toBeTruthy(), { timeout: 3_000 });
    for (const name of ["Status", "Tasks", "Goal", "Plan"]) expect(slot.getAllByText(name).length).toBeGreaterThan(0);
    expect(slot.container.querySelectorAll("[data-card]")).toHaveLength(5);
    slot.lifecycle.unmount(); getPluginQueryClient().clear();
  });

  it("uses one exact typed RPC per independent card", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkStatus = vi.fn(() => status); const getWorkOutcome = vi.fn(() => outcome); const getWorkGoal = vi.fn(() => null); const getWorkPlan = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_one", params: null }, { rpc: fixture({ getWorkStatus, getWorkOutcome, getWorkGoal, getWorkPlan }) });
    await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(1));
    for (const method of [getWorkStatus, getWorkOutcome, getWorkGoal, getWorkPlan]) expect(method).toHaveBeenCalledWith({ threadId: "thr_one" });
    slot.lifecycle.unmount(); getPluginQueryClient().clear();
  });
});
