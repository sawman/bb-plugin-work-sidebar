// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
const taskResult = { available: true, tasks: [], projects: [], error: null };
const aggregate = { tasksAvailable: true, currentThread: { title: "Thread", status: "idle" as const, runtimeStatus: "idle", providerId: "codex" }, tasks: [], subtasks: [], outcome: null, executionTasks: [], bindings: [], legacy: { state: "none" as const, taskIds: [], message: null }, goal: null, todos: [], children: [], currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null, repository: { outcome: "absent" as const, message: null, branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] }, tracker: { visible: false, available: false, message: null, suggestions: [], item: null, statusOptions: [] } };
const status = { currentThread: aggregate.currentThread, children: [] };
const outcome = { tasksAvailable: true, outcome: null, executionTasks: [], bindings: [] };
const populatedOutcome = { tasksAvailable: true, outcome: { id: "task_1", projectId: "project_1", projectName: "Work", key: "WORK-1", title: "Ship cards", status: "todo" as const, priority: "high" as const, dueDate: "2026-08-30", parentTaskId: null, position: 1 }, executionTasks: [], bindings: [] };

function fixture(overrides: Partial<Rpc> = {}): Rpc {
  return { sidebarTasks: () => taskResult, sidebarTaskLinks: () => ({ available: true, links: {}, error: null }), getWorkContext: () => aggregate, getWorkChanges: () => ({ currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null, repository: aggregate.repository }), getWorkTracker: () => aggregate.tracker, getWorkProviderStatus: () => ({ tone: "green", providerId: "codex", providerName: "Codex", statusUrl: null, status: "ready", message: null }), getGitHubApiHealth: () => ({ state: "available", scope: "unknown", message: null, retryAt: null }), getWorkStatus: () => status, getLatestActivity: () => ({ currentThread: { status: "idle", runtimeStatus: "idle" }, latest: null, lastUser: null, current: null }), getWorkOutcome: () => outcome, getWorkGoal: () => null, getWorkPlan: () => ({ items: [] }), ...overrides } as Rpc;
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

  it("invalidates every card on realtime and manual Work refresh", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkStatus = vi.fn(() => status);
    const getWorkOutcome = vi.fn(() => outcome);
    const getWorkGoal = vi.fn(() => null);
    const getWorkPlan = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_one", params: null }, { rpc: fixture({ getWorkStatus, getWorkOutcome, getWorkGoal, getWorkPlan }) });
    await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(1));
    await slot.behavior.emitRealtime("work-sidebar:changed", { changed: "work" });
    await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(2));
    fireEvent.click(slot.getByRole("button", { name: "Refresh work context" }));
    await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(3));
    for (const method of [getWorkStatus, getWorkOutcome, getWorkGoal, getWorkPlan]) expect(method).toHaveBeenCalledTimes(3);
    slot.lifecycle.unmount(); getPluginQueryClient().clear();
  });

  it("renders registered loading, empty, and populated cards without duplicate headings", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_one", params: null }, { rpc: fixture({ sidebarTasks: () => ({ ...taskResult, tasks: [{ id: "task_2", projectId: "project_1", projectName: "Work", key: "WORK-2", title: "Attached task", status: "todo", priority: "none", dueDate: null, parentTaskId: null, position: 1, linkedThreadIds: ["thr_one"], assignee: "human" }] }), getWorkOutcome: () => populatedOutcome }) });
    await waitFor(() => expect(slot.getByText("Attached task")).toBeTruthy());
    expect(slot.getByText("Ship cards")).toBeTruthy();
    for (const name of ["Status", "Tasks", "Outcome", "Goal", "Plan"]) expect(slot.getAllByText(name)).toHaveLength(1);
    expect(slot.container.querySelector(".ws-thread-task-card")).toBeTruthy();
    slot.lifecycle.unmount(); getPluginQueryClient().clear();
  });

  it("retries only the failed card and uses Query mutation busy/success state", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    let resolveUpdate!: (value: { task: NonNullable<typeof populatedOutcome.outcome> }) => void;
    const pendingUpdate = new Promise<{ task: NonNullable<typeof populatedOutcome.outcome> }>((resolve) => { resolveUpdate = resolve; });
    const getWorkOutcome = vi.fn(() => populatedOutcome);
    const updateWorkTask = vi.fn(() => pendingUpdate);
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_one", params: null }, { rpc: fixture({ getWorkOutcome, updateWorkTask }) });
    await waitFor(() => expect(slot.getByText("Ship cards")).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: /Move Ship cards to In Progress/ }));
    await waitFor(() => expect(updateWorkTask).toHaveBeenCalledWith({ taskId: "task_1", status: "in_progress" }));
    expect((slot.getByRole("button", { name: /Move Ship cards to In Progress/ }) as HTMLButtonElement).disabled).toBe(true);
    resolveUpdate({ task: populatedOutcome.outcome! });
    await waitFor(() => expect(getWorkOutcome).toHaveBeenCalledTimes(2));
    slot.lifecycle.unmount(); getPluginQueryClient().clear();

    const rejected = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_one", params: null }, { rpc: fixture({ getWorkOutcome: () => populatedOutcome, updateWorkTask: () => Promise.reject(new Error("update failed")) }) });
    await waitFor(() => expect(rejected.getByText("Ship cards")).toBeTruthy());
    const rejectedButton = rejected.getByRole("button", { name: /Move Ship cards to In Progress/ }) as HTMLButtonElement;
    fireEvent.click(rejectedButton);
    await waitFor(() => expect(rejectedButton.disabled).toBe(false));
    rejected.lifecycle.unmount(); getPluginQueryClient().clear();
  });

  it("keeps cached A visible across A-to-B-to-A registered slot switches while revalidating", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkStatus = vi.fn(() => ({ ...status, currentThread: { ...status.currentThread, status: "active" as const } }));
    const getLatestActivity = vi.fn(({ threadId }) => ({ currentThread: { status: "active" as const, runtimeStatus: "active" }, latest: { text: `activity ${threadId}`, kind: "activity" as const }, lastUser: null, current: null }));
    const first = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_a", params: null }, { rpc: fixture({ getWorkStatus, getLatestActivity }) });
    await waitFor(() => expect(first.getByText("activity thr_a")).toBeTruthy());
    first.lifecycle.unmount();
    const second = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_b", params: null }, { rpc: fixture({ getWorkStatus, getLatestActivity }) });
    await waitFor(() => expect(second.getByText("activity thr_b")).toBeTruthy());
    second.lifecycle.unmount();
    const returned = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_a", params: null }, { rpc: fixture({ getWorkStatus, getLatestActivity }) });
    expect(returned.getByText("activity thr_a")).toBeTruthy();
    await waitFor(() => expect(getLatestActivity.mock.calls.filter(([input]) => input.threadId === "thr_a").length).toBeGreaterThanOrEqual(2));
    returned.lifecycle.unmount(); getPluginQueryClient().clear();
  });
});
